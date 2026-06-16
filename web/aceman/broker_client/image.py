"""Image-management facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient


class ImageBrokerClient:
    """Image build/remove facade. ``install`` returns immediately —
    the broker spawns the build in a background thread and the UI
    polls ``status`` for state + log tail."""

    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    def status(self) -> dict:
        return self.broker.call("image.status", timeout=10)

    def install(self) -> dict:
        return self.broker.call("image.install", timeout=15)

    def remove(self) -> dict:
        return self.broker.call("image.remove", timeout=60)
