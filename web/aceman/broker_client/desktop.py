"""Desktop-entry / mimeapps.list facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient


class DesktopBrokerClient:
    """Thin facade for desktop-integration ops, delegated to the broker.

    All host-side work (writing
    ``~/.local/share/applications/aceman.desktop``, running
    ``update-desktop-database``, editing ``mimeapps.list``, calling
    ``xdg-mime``) lives in the broker. The web frontend just sends
    intent over the unix socket. That keeps the web's role identical
    whether it's running on the host or in a container.

    The web still owns the host/port the ``Exec=`` line needs to
    embed, because those are determined at web launch (from
    ``--host`` / ``--port``) and the broker doesn't know them. They
    flow through as validated params on each install request.
    """

    def __init__(self, broker: BrokerClient, *, host: str, port: int) -> None:
        self.broker = broker
        self.host = host
        self.port = port

    def status(self) -> dict:
        return self.broker.call("desktop.status", timeout=5)

    def install(self, *, register_scheme: bool) -> dict:
        return self.broker.call(
            "desktop.install",
            params={"host": self.host, "port": self.port,
                    "register_scheme": register_scheme},
            timeout=15,
        )

    def uninstall(self) -> dict:
        return self.broker.call("desktop.uninstall", timeout=10)

    def restore_mimeapps_backup(self) -> dict:
        return self.broker.call(
            "desktop.restore_mimeapps_backup", timeout=5)
