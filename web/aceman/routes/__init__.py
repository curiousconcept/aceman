"""Route registration entry-points.

Each submodule exposes a ``register(router)`` function that attaches
its routes to the shared :class:`Router`. ``register_all(router)``
calls every one, used by ``main()`` at startup.
"""

from __future__ import annotations

from ..router import Router


def register_all(router: Router) -> None:
    # Each module is imported lazily so a removed/disabled route group
    # only fails when the route fires, not at startup.
    from . import (
        browsers,
        config_routes,
        desktop_routes,
        engine_routes,
        favourites,
        heartbeat as hb,
        logs,
        players,
        search,
        storage_mode,
    )
    browsers.register(router)
    config_routes.register(router)
    desktop_routes.register(router)
    engine_routes.register(router)
    favourites.register(router)
    hb.register(router)
    logs.register(router)
    players.register(router)
    search.register(router)
    storage_mode.register(router)
    # NOTE: /api/player/stop, /api/open-in-browser, /api/stream/proxy,
    # /api/engine/image (POST/DELETE), /api/restart, /api/shutdown,
    # /api/factory-reset, and the static / index routes all still live
    # in aceman_web.py's legacy Handler dispatch — they touch
    # Handler._active_proc / Handler.httpd / threading and require a
    # broader refactor to come out cleanly. Session 3.
