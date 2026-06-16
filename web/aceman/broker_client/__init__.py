"""Unix-socket clients for talking to the host-side aceman-broker.

``BrokerClient`` is the transport — one JSON line per call. Each
facade (``EngineBrokerClient``, ``ImageBrokerClient``, …) wraps it
with a domain API so handlers stay free of action-name strings.
"""

from __future__ import annotations

from .base import BrokerClient, BrokerError
from .engine import EngineBrokerClient
from .image import ImageBrokerClient
from .players import PlayersBrokerClient
from .browsers import BrowsersBrokerClient
from .desktop import DesktopBrokerClient

__all__ = [
    "BrokerClient", "BrokerError",
    "EngineBrokerClient", "ImageBrokerClient",
    "PlayersBrokerClient", "BrowsersBrokerClient",
    "DesktopBrokerClient",
]
