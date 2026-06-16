"""Player detection + control facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient


class PlayersBrokerClient:
    """Host-introspection facade for installed players. The broker runs
    on the host and knows what's installed there; the web frontend
    never has to touch the host filesystem itself.

    Returned shape from ``list()``:

        {"platform": "linux"|"darwin"|"windows",
         "available": [{"name": "vlc", "source": "system"|"flatpak"}, ...]}
    """

    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    def list(self) -> dict:
        return self.broker.call("players.list", timeout=10)

    def stop(self) -> dict:
        # SIGTERMs the shell wrapper that's currently playing (if
        # any), and waits for it to exit so the engine session is
        # fully released by the time we return — otherwise a
        # follow-up in-browser play would open a second engine
        # session and the two players would briefly stream the same
        # content at once. Broker self-caps at ~3s + SIGKILL
        # fallback; 8s leaves headroom for the round trip.
        return self.broker.call("player.stop", timeout=8)
