"""Restart-path primitives shared by ``engine.py`` and
``web_lifecycle.py``.

A plain ``podman restart`` only signals the existing container — it
doesn't re-pull or re-create against the image tag, so any source
change baked into a freshly-built image is invisible to the running
container. ``pick_up_image_changes`` snapshots the
``aceman.commit`` label, invokes the shared
``container/ensure-image-helper.sh`` to rebuild if the source moved,
and reports whether the label actually changed. Callers that see a
change recreate the container via :func:`recreate_container` (which
replays the original ``CreateCommand`` after ``podman rm``);
callers that don't can fall back to the cheap ``podman restart``.
"""

from __future__ import annotations

import json
import subprocess

from ..config import ENSURE_IMAGE_HELPER
from ..engine_ops import image_commit_label
from ..logging_util import _log, _safe


def _image_id(tag: str) -> str:
    """Resolve the local image ID for ``tag`` (empty if absent).

    Used by :func:`pick_up_image_changes` to detect a rebuild even
    when the ``aceman.commit`` label can't help — that's the case
    when the working tree is dirty: ensure-image-helper deliberately
    omits the label so a dirty image isn't mistaken for a clean one,
    so the before/after labels are both empty and a label-only
    comparison would say "nothing moved" even though podman build
    just produced a brand-new image ID."""
    try:
        r = subprocess.run(
            ["podman", "image", "inspect", "--format", "{{.Id}}", tag],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


# Build-trigger timeout. The helper invokes podman build; a from-scratch
# build can take a few minutes (apt install ffmpeg etc.). The layer
# cache makes the typical incremental case <5 s. 5 min is the same
# budget aceman_web uses for its at-startup ensure_*_image call.
ENSURE_IMAGE_TIMEOUT = 300


def pick_up_image_changes(kind: str, image_tag: str) -> bool:
    """Trigger ``ensure_*_image`` for ``kind`` (``"engine"`` /
    ``"web"``) and return True iff the image's ``aceman.commit`` label
    changed (i.e. a fresh build actually happened). Returns False on
    helper failure — restart still proceeds via plain podman, just
    without the rebuild."""
    if not ENSURE_IMAGE_HELPER.is_file():
        _log("restart", "ensure-image helper missing at %s", ENSURE_IMAGE_HELPER)
        return False
    before_label = image_commit_label(image_tag)
    before_id = _image_id(image_tag)
    try:
        r = subprocess.run(
            ["bash", str(ENSURE_IMAGE_HELPER), kind],
            capture_output=True, text=True, timeout=ENSURE_IMAGE_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        _log("restart", "%s ensure-image failed: %s", kind, e)
        return False
    if r.returncode != 0:
        _log("restart", "%s ensure-image exited %d: %s",
             kind, r.returncode,
             _safe((r.stderr or r.stdout or "").strip()))
        return False
    after_label = image_commit_label(image_tag)
    after_id = _image_id(image_tag)
    # Two ways the image counts as "moved": label changed (clean
    # rebuild at a new commit) OR the image ID changed even though
    # the label didn't (dirty-tree rebuild — ensure-image-helper
    # omits the label on dirty so a working-tree edit looks like a
    # no-op to a label-only check, even though podman build just
    # produced a fresh image). Either way: the running container is
    # still on the OLD layers and a plain `podman restart` would
    # ship stale code; force a recreate so the new bits actually run.
    label_moved = bool(after_label) and after_label != before_label
    id_moved = bool(after_id) and after_id != before_id
    changed = label_moved or id_moved
    if changed:
        _log("restart", "%s image moved label=%s->%s id=%s->%s",
             kind, before_label or "<none>", after_label or "<none>",
             (before_id or "<none>")[:19], (after_id or "<none>")[:19])
    return changed


def recreate_container(name: str, *, stop_timeout: int = 5,
                       rm_timeout: int = 10,
                       run_timeout: int = 60) -> None:
    """Replace the running container in place with one created from
    the current (just-rebuilt) image tag. The trick: podman records
    the exact argv that created the container in
    ``Config.CreateCommand``; replaying it after ``podman rm`` picks
    up whatever the tag now points at, with every other knob (volumes,
    network, port-publish, security-opts, env, …) preserved verbatim.
    Cleaner than reconstructing the original ``podman run`` from
    inspect output piece-by-piece — and guaranteed to match because
    we're using podman's own record."""
    try:
        inspect = subprocess.check_output(
            ["podman", "container", "inspect", name],
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired,
            subprocess.CalledProcessError) as e:
        raise RuntimeError(
            f"podman inspect for {name!r} failed: {e}") from e

    try:
        spec = json.loads(inspect.decode())[0]
    except (ValueError, IndexError) as e:
        raise RuntimeError(
            f"podman inspect for {name!r} not parseable: {e}") from e

    create_cmd = spec.get("Config", {}).get("CreateCommand")
    if not create_cmd:
        raise RuntimeError(
            f"no CreateCommand recorded for {name!r}; can't replay")

    # Force detach on the replay so subprocess.run doesn't block waiting
    # on a foreground container. The broker is single-threaded per
    # action, and a non-detached `podman run` would hold this thread
    # for the lifetime of the container, deadlocking every subsequent
    # request. Inject `-d` after the `run` verb if neither `-d` nor
    # `--detach` is already present.
    if "-d" not in create_cmd and "--detach" not in create_cmd:
        try:
            run_idx = create_cmd.index("run")
            create_cmd = (create_cmd[:run_idx + 1]
                          + ["-d"]
                          + create_cmd[run_idx + 1:])
        except ValueError:
            # No `run` verb in the recorded command — unusual but not
            # actionable here; fall through and let podman complain.
            pass

    _log("restart", "%s: recreating from CreateCommand (%d argv)",
         name, len(create_cmd))

    # podman rm -f handles both the stop and the rm in one step.
    # We don't fail loudly if stop times out — a -f rm forces the kill.
    try:
        subprocess.run(
            ["podman", "rm", "-f", "-t", str(stop_timeout), name],
            capture_output=True, timeout=stop_timeout + rm_timeout,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"podman rm -f {name!r} failed: {e}") from e

    # Re-issue the original run. run-container.sh / run-web-container.sh
    # both `exec podman run --rm …`, so the create command we recorded
    # IS the run argv — no transformation needed.
    try:
        r = subprocess.run(
            create_cmd,
            capture_output=True, text=True, timeout=run_timeout,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(
            f"podman run (replay) for {name!r} failed: {e}") from e
    if r.returncode != 0:
        raise RuntimeError(
            f"podman run (replay) for {name!r} exited "
            f"{r.returncode}: "
            f"{_safe((r.stderr or r.stdout or '').strip()) or '<no output>'}")
