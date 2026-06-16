"""Server-side proxy for search-ace.stream.

The browser never talks to the upstream directly so CORS is a non-issue
and the user's IP isn't exposed. The response is parsed and
re-projected into a minimal ``{cid, name, translated_name}`` shape;
anything that doesn't pass validation is dropped silently.

The upstream is treated as fully adversarial:

  * HTTPS only (cert verified), TLS 1.2 minimum pinned explicitly.
  * Fixed endpoint URL; **any** redirect is refused.
  * Response body capped at ``MAX_RESPONSE_BYTES``; strict UTF-8 + JSON.
  * Items without a valid 40-hex content_id are dropped.
  * Names scrubbed of every band of dangerous codepoints (see
    ``_DANGEROUS``).
  * Result count capped at ``MAX_RESULTS``.
  * Outgoing query is scrubbed and length-capped before send.
"""

from __future__ import annotations

import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from .constants import HEX40
from .log_util import _log, _sanitize_msg


class SearchError(Exception):
    pass


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse every redirect. Our ``BASE`` is a fixed URL; if the
    upstream answers with a 3xx, either the endpoint has genuinely
    moved (which we want to surface as a hard error so it gets noticed
    and the constant updated), or an attacker / DNS-hijacker is trying
    to steer us somewhere else. Don't follow, don't allow-list, just
    raise."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url, code, "blocked: upstream attempted redirect",
            headers, fp,
        )


class SearchProxy:
    BASE = "https://search-ace.stream/search"
    MAX_QUERY_LEN = 128
    MAX_RESPONSE_BYTES = 256 * 1024
    MAX_RESULTS = 50
    MAX_NAME_LEN = 200
    TIMEOUT = 8.0

    # Codepoints we strip from any string we hand back to the frontend
    # or forward to the upstream. Belt-and-suspenders against a hostile
    # upstream trying to influence what the browser renders.
    #
    # Written with explicit \uXXXX escapes — not raw glyphs — because a
    # literal U+2028 LINE SEPARATOR in source code is invisible to
    # readers and editors but reads as U+0020 SPACE under some text
    # tools, which would silently widen the class to "every printable
    # ASCII char".
    _DANGEROUS = re.compile(
        "["
        "\u0000-\u001f\u007f-\u009f"
        "\u200b-\u200f"
        "\u2028-\u202e"
        "\u2060"
        "\u2066-\u2069"
        "\ufeff"
        "]"
    )

    def __init__(self) -> None:
        ctx = ssl.create_default_context()
        # Belt-and-suspenders: defaults already include TLS 1.2+ on
        # Python 3.10+, but pin minimum_version explicitly so a future
        # OpenSSL config drift can't silently re-enable TLS 1.0/1.1.
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx),
            _NoRedirectHandler(),
        )

    def search(self, raw_query: str) -> "list[dict]":
        q = self._clean_query(raw_query)
        if not q:
            _log("search",
                 "empty query after sanitisation; raw_len=%d",
                 len(raw_query) if isinstance(raw_query, str) else -1)
            return []
        # Log query LENGTH only — search terms are potentially sensitive.
        _log("search", "→ upstream query_len=%d ", len(q))
        url = self.BASE + "?" + urllib.parse.urlencode({"query": q})
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": "aceman_web",
        })
        t0 = time.monotonic()
        try:
            with self._opener.open(req, timeout=self.TIMEOUT) as r:
                body = r.read(self.MAX_RESPONSE_BYTES + 1)
                status = getattr(r, "status", None) or r.getcode()
        except urllib.error.HTTPError as e:
            _log("search", "← HTTP %d in %.2fs",
                 e.code, time.monotonic() - t0)
            raise SearchError(f"upstream {e.code}") from e
        except urllib.error.URLError as e:
            _log("search", "← unreachable in %.2fs: %s",
                 time.monotonic() - t0, e.reason)
            raise SearchError(
                f"upstream unreachable: {_sanitize_msg(str(e.reason))}") from e
        except (TimeoutError, socket.timeout):
            _log("search", "← timeout after %.2fs", time.monotonic() - t0)
            raise SearchError("upstream timed out")
        except ssl.SSLError as e:
            _log("search", "← TLS error in %.2fs: %s",
                 time.monotonic() - t0, e)
            raise SearchError(
                f"upstream TLS error: {_sanitize_msg(str(e))}") from e

        elapsed = time.monotonic() - t0
        _log("search", "← HTTP %s in %.2fs body=%d bytes",
             status, elapsed, len(body))

        if len(body) > self.MAX_RESPONSE_BYTES:
            raise SearchError("upstream response exceeded size cap")
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError as e:
            _log("search", "non-utf-8 body: %s", e)
            raise SearchError(
                f"upstream returned non-utf-8: {_sanitize_msg(str(e))}") from e
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, RecursionError, ValueError) as e:
            _log("search", "non-JSON body (first 200B): %r", body[:200])
            raise SearchError(
                f"upstream returned malformed JSON: "
                f"{_sanitize_msg(str(e))}") from e

        if not isinstance(data, list):
            _log("search", "non-list payload type=%s", type(data).__name__)
            raise SearchError("upstream returned a non-list payload")

        out: "list[dict]" = []
        dropped = 0
        for item in data[: self.MAX_RESULTS * 4]:
            cleaned = self._clean_item(item)
            if cleaned is None:
                dropped += 1
                continue
            out.append(cleaned)
            if len(out) >= self.MAX_RESULTS:
                break
        _log("search", "parsed: %d kept, %d dropped (of %d raw)",
             len(out), dropped, len(data))
        return out

    @classmethod
    def _clean_query(cls, raw: object) -> str:
        if not isinstance(raw, str):
            return ""
        q = cls._DANGEROUS.sub("", raw).strip()
        return q[: cls.MAX_QUERY_LEN]

    @classmethod
    def _clean_name(cls, raw: object) -> str:
        if not isinstance(raw, str):
            return ""
        s = cls._DANGEROUS.sub("", raw).strip()
        return s[: cls.MAX_NAME_LEN]

    @classmethod
    def _clean_item(cls, item: object) -> "dict | None":
        if not isinstance(item, dict):
            return None
        cid = item.get("content_id")
        if not isinstance(cid, str) or not HEX40.match(cid):
            return None
        name = cls._clean_name(item.get("name"))
        tname = cls._clean_name(item.get("translated_name"))
        if not name and not tname:
            return None
        return {"cid": cid.lower(), "name": name, "translated_name": tname}
