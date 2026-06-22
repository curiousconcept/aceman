"""Unix-socket clients for talking to the host-side aceman-broker.

``BrokerClient`` is the transport — one JSON line per call. Each
facade (``EngineBrokerClient``, ``ImageBrokerClient``, …) wraps it
with a domain API so handlers stay free of action-name strings.
"""

from __future__ import annotations

from .base import BrokerClient, BrokerError
from .engine import EngineBrokerClient
from .gpu import GpuBrokerClient
from .image import ImageBrokerClient
from .players import PlayersBrokerClient
from .browsers import BrowsersBrokerClient
from .desktop import DesktopBrokerClient
from .web import WebBrokerClient

__all__ = [
    "BrokerClient", "BrokerError",
    "EngineBrokerClient", "GpuBrokerClient", "ImageBrokerClient",
    "PlayersBrokerClient", "BrowsersBrokerClient",
    "DesktopBrokerClient", "WebBrokerClient",
]
