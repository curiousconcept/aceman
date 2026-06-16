"""Engine-lifecycle facade over the broker socket."""

from __future__ import annotations

from .base import BrokerClient, BrokerError
from ..engine_client import engine_probe


class EngineBrokerClient:
    """Engine-lifecycle facade with the same shape as the old
    in-process EngineManager: status / start / stop / probe /
    container_running. All state-changing calls go through the broker;
    the loopback probe stays in-process because the UI polls it every
    few seconds and we don't need to round-trip a unix socket for a
    one-shot HTTP GET."""

    def __init__(self, broker: BrokerClient, engine_url: str) -> None:
        self.broker = broker
        self.engine_url = engine_url

    def probe(self, timeout: float = 5.0) -> bool:
        return engine_probe(self.engine_url, timeout=timeout)

    def container_running(self) -> bool:
        # Used by the idle watcher (best-effort: if the broker's down
        # we just treat the container as "not ours to manage" and
        # skip the auto-stop attempt).
        try:
            return bool(self.broker.call("engine.status", timeout=5)
                        .get("container"))
        except BrokerError:
            return False

    def status(self) -> dict:
        return self.broker.call("engine.status", timeout=10)

    def start(self) -> dict:
        # Broker budget is launcher 60s + probe poll 30s = 90s; give
        # the socket call a small headroom on top so a borderline-slow
        # podman start doesn't show up as a misleading "broker timed
        # out".
        return self.broker.call("engine.start", timeout=120)

    def stop(self) -> dict:
        return self.broker.call("engine.stop", timeout=30)
