"""Engine-local search source: ``GET /search`` on the acestream engine.

A second search source alongside :mod:`server.search` (the search-ace.stream
proxy). Normalises the engine's nested response into the SAME minimal
``{cid, name, translated_name}`` shape the proxy emits, so the merge layer
and the whole UI are source-agnostic.

The engine is treated as adversarial — identical hardening to
``engine_client``/``SearchProxy``:

  * Fixed loopback endpoint (the configured engine URL); query scrubbed +
    length-capped before send.
  * Response body capped at ``MAX_SEARCH_BYTES``; strict UTF-8 + dict JSON.
  * Items without a valid 40-hex ``infohash`` are dropped.
  * Names scrubbed via the shared ``clean_str``; result count capped.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request

from .constants import HEX40
from .log_util import _log, _sanitize_msg
from .search import SearchError, clean_str

# The engine /search payload is bigger than a getstream reply (50 grouped
# results with metadata + icons ≈ 25 KB observed), so it gets its own cap
# rather than reusing the getstream-tuned MAX_ENGINE_BYTES (64 KB).
MAX_SEARCH_BYTES = 512 * 1024
MAX_QUERY_LEN = 128
MAX_NAME_LEN = 200
MAX_RESULTS = 50
PAGE_SIZE = 50
TIMEOUT = 8.0


def _clean_item(item: object) -> "dict | None":
    """One engine result item → ``{cid, name, translated_name}`` or None.
    The engine has no translation, so translated_name is always blank."""
    if not isinstance(item, dict):
        return None
    cid = item.get("infohash")
    if not isinstance(cid, str) or not HEX40.match(cid):
        return None
    name = clean_str(item.get("name"), MAX_NAME_LEN)
    if not name:
        return None
    return {"cid": cid.lower(), "name": name, "translated_name": ""}


def engine_search(engine: str, raw_query: str) -> "list[dict]":
    """Search the engine and return normalised results. Raises
    :class:`SearchError` on any unreachable / malformed / oversize
    response so the route can treat one dead source as best-effort."""
    q = clean_str(raw_query, MAX_QUERY_LEN)
    if not q:
        return []
    _log("search", "→ engine query_len=%d", len(q))
    url = engine.rstrip("/") + "/search?" + urllib.parse.urlencode(
        {"query": q, "page": 0, "page_size": PAGE_SIZE})
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            body = r.read(MAX_SEARCH_BYTES + 1)
    except urllib.error.URLError as e:
        raise SearchError(
            f"engine search unreachable: "
            f"{_sanitize_msg(str(getattr(e, 'reason', e)))}") from e
    except (TimeoutError, socket.timeout):
        raise SearchError("engine search timed out")

    if len(body) > MAX_SEARCH_BYTES:
        raise SearchError("engine search response exceeded size cap")
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError,
            ValueError) as e:
        raise SearchError(
            f"engine search malformed: {_sanitize_msg(str(e))}") from e
    if not isinstance(data, dict):
        raise SearchError("engine search non-object payload")
    result = data.get("result")
    if not isinstance(result, dict):
        # Engine reports a structured error here (e.g. {"error": ...}).
        raise SearchError("engine search returned no result")
    groups = result.get("results")
    if not isinstance(groups, list):
        return []

    out: "list[dict]" = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        items = group.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            cleaned = _clean_item(item)
            if cleaned is None:
                continue
            out.append(cleaned)
            if len(out) >= MAX_RESULTS:
                _log("search", "engine: %d kept (capped)", len(out))
                return out
    _log("search", "engine: %d kept", len(out))
    return out
