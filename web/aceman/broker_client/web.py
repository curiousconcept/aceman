"""Web-container broker client facade."""

from __future__ import annotations

from .base import BrokerClient, BrokerError


class WebBrokerClient:
    def __init__(self, broker: BrokerClient) -> None:
        self.broker = broker

    def memory(self) -> dict:
        try:
            return self.broker.call("web.memory", timeout=8)
        except BrokerError:
            return {"available": False}
