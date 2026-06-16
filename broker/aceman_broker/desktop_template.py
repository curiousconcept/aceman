"""Desktop Entry body generator.

Generates the ``aceman.desktop`` file the broker writes to
``~/.local/share/applications/``. Pure function: takes the launcher
path, host, port, container-mode flag, and scheme-handler MIME type,
returns the file content as a string. No I/O — the caller is
responsible for the actual write.

Splitting the generator from the file write is the security
prerequisite for testing: the assertions about what *appears* in
``Exec=`` (each special character escaped, no shell expansion
possible) live here, not coupled to a temp-dir filesystem fixture.
"""

from __future__ import annotations

from .desktop_helpers import desktop_quote_arg


DESKTOP_SCHEME_HANDLER = "x-scheme-handler/acestream"


def render_desktop_entry(
        launcher_path: str, host: str, port: int,
        *, container: bool = False,
        scheme_handler: str = DESKTOP_SCHEME_HANDLER) -> str:
    """Return the full body of ``aceman.desktop``.

    Args:
        launcher_path: absolute path to the aceman_web launcher.
            Quoted before splicing into Exec=.
        host: --host argument for the launcher. Quoted before
            splicing into Exec=. Validate via ``validators.validate_host``
            BEFORE calling this function.
        port: --port argument. Coerced to ``str`` — caller should
            validate with ``validators.validate_port`` first.
        container: append ``--container`` to the Exec line so the
            launcher routes through container/aceman-web/run-web-container.sh.
        scheme_handler: the MimeType= value. Defaults to the
            acestream scheme; exposed as a parameter so tests can
            verify what gets emitted.
    """
    parts = [
        desktop_quote_arg(launcher_path),
        "--open-browser",
        "--host", desktop_quote_arg(host),
        "--port", str(port),
    ]
    if container:
        parts.append("--container")
    parts.append("%u")
    exec_line = " ".join(parts)
    return (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Version=1.0\n"
        "Name=aceman\n"
        "GenericName=Ace Stream viewer\n"
        "Comment=Watch Ace Stream content via a sandboxed engine\n"
        f"Exec={exec_line}\n"
        "Terminal=false\n"
        "Categories=AudioVideo;Player;Network;\n"
        "Keywords=acestream;video;p2p;stream;\n"
        "StartupNotify=true\n"
        "Icon=multimedia-video-player\n"
        f"MimeType={scheme_handler};\n"
    )
