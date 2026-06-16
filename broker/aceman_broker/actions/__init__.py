"""Action registry — the broker's authority surface.

Each submodule defines one or more ``action_<name>`` callables and
calls ``register(actions, "<name>", fn)`` to expose them. The
dispatcher imports ``ACTIONS`` from here; nothing else touches the
registry.

Adding a new action = drop a function + one register call. That's
the OCP boundary the split exists for.
"""

from __future__ import annotations


def build_registry() -> "dict[str, callable]":
    """Lazy-build the ACTIONS dict so each submodule can be imported
    independently for tests (avoids circular import chains)."""
    from . import engine, image, players, browsers, desktop, web_lifecycle

    actions: "dict[str, callable]" = {}
    engine.register(actions)
    image.register(actions)
    players.register(actions)
    browsers.register(actions)
    desktop.register(actions)
    web_lifecycle.register(actions)
    return actions


def register(actions: "dict[str, callable]", name: str, fn) -> None:
    if name in actions:
        raise ValueError(f"duplicate action: {name}")
    actions[name] = fn
