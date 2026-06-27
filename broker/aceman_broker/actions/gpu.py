"""GPU capability detection.

Probes for NVIDIA (nvidia-smi, host) and VA-API (/dev/dri/renderD128 +
vainfo). Returns a capability map the web uses to build the ffmpeg
command. Refuses nvidia capabilities if nvidia-smi is absent.

VA-API is probed where ffmpeg actually runs: inside the web container
when it's up (`podman exec <web> vainfo`), else on the host (--native).
This matters because host and container can ship DIFFERENT iHD builds —
Fedora's host iHD is codec-stripped and hides H.264 encode, while the
image carries the full driver. Probing the host would wrongly disable
GPU encode on a box whose container can encode fine.
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess

from ..config import WEB_NAME
from ..engine_ops import container_running_named
from ..logging_util import _log
from . import register as _register

_RENDER_NODE = "/dev/dri/renderD128"


def _vainfo_argv() -> "list[str] | None":
    """vainfo command targeting the render node, run where ffmpeg runs:
    via the web container if it's up, else on the host. None when no
    vainfo is reachable (no container and none on the host)."""
    probe = ["vainfo", "--display", "drm", "--device", _RENDER_NODE]
    if container_running_named(WEB_NAME):
        return ["podman", "exec", WEB_NAME, *probe]
    if shutil.which("vainfo"):
        return probe
    return None


def _probe_nvidia() -> "dict | None":
    if not shutil.which("nvidia-smi"):
        return None
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        name = (r.stdout.strip().splitlines() or ["unknown"])[0]
    except (subprocess.TimeoutExpired, OSError):
        name = "unknown"
    return {"name": name}


def _probe_vaapi() -> "dict | None":
    device = pathlib.Path(_RENDER_NODE)
    if not device.exists():
        return None
    h264_enc = False
    va_driver = None
    argv = _vainfo_argv()
    if argv is not None:
        try:
            # podman exec adds container start-up latency over a bare host
            # call, so the budget is a touch wider than a plain subprocess.
            r = subprocess.run(
                argv, capture_output=True, text=True, timeout=8,
            )
            combined = r.stdout + r.stderr
            # Substring match is deliberate: "VAEntrypointEncSliceLP" (the
            # low-power encoder modern Intel iGPUs expose) contains
            # "VAEntrypointEncSlice", so LP-only chips count as encode-capable.
            h264_enc = (
                "VAProfileH264" in combined
                and "VAEntrypointEncSlice" in combined
            )
            # e.g. "libva info: Trying to open .../radeonsi_drv_video.so"
            m = re.search(r"/(\w+)_drv_video\.so", combined)
            if m:
                va_driver = m.group(1)
        except (subprocess.TimeoutExpired, OSError):
            pass
    # Fallback: infer driver from kernel DRM driver name (no vainfo needed).
    if va_driver is None:
        drm_link = pathlib.Path("/sys/class/drm/renderD128/device/driver")
        if drm_link.exists():
            drm = drm_link.resolve().name
            if drm == "amdgpu":
                va_driver = "radeonsi"
            elif drm in ("i915", "xe"):
                va_driver = "iHD"
    return {"device": str(device), "h264_enc": h264_enc, "driver": va_driver}


def _probe_qsv(vaapi: "dict | None") -> bool:
    # QSV is the Intel VA-API path: true when the loaded driver is iHD/i965.
    # Derived from the vaapi probe so we don't fork vainfo a second time.
    return bool(vaapi) and vaapi.get("driver") in ("iHD", "i965")


def action_gpu_status(params: "dict | None" = None) -> dict:
    nvidia = _probe_nvidia()
    vaapi = _probe_vaapi()
    qsv = _probe_qsv(vaapi)
    _log("gpu", "status: nvidia=%s vaapi=%s qsv=%s",
         bool(nvidia), bool(vaapi), qsv)
    return {
        "available": nvidia is not None or vaapi is not None,
        "nvidia": nvidia,
        "vaapi": vaapi,
        "qsv": qsv,
    }


def register(actions: dict) -> None:
    _register(actions, "gpu.status", action_gpu_status)
