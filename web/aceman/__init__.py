"""aceman_web — Python package backing the web frontend.

Pieces previously inlined in ``aceman_web.py`` now live in focused
submodules:

  constants         — paths, regexes, size caps (was web/config.py)
  log_util          — _terminal_safe, _sanitize_msg, _log
  heartbeat         — HeartbeatTracker
  engine_client     — engine_probe, engine_getstream, _release_engine_session
  broker_client/    — UNIX-socket client + per-domain facades
  search            — SearchProxy
  favourites        — Config, FavStore, DuplicateCidError
  desktop_helpers   — _desktop_quote_arg

Behaviour and on-the-wire shapes are unchanged from the monolith;
this split is purely structural so each unit can be tested and
reasoned about in isolation.
"""

from __future__ import annotations
