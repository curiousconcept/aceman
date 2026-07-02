"""Merge results from multiple search sources into one deduped list.

Pure + source-agnostic: each input is a list of ``{cid, name,
translated_name}`` dicts (the shape every source emits). Dedup is by
``cid`` — the first source to yield a cid wins, so callers control
precedence by ordering the input lists. Output is capped at
``max_results``.
"""

from __future__ import annotations


def merge_results(result_lists: "list[list[dict]]",
                  *, max_results: int = 50) -> "list[dict]":
    seen: "set[str]" = set()
    out: "list[dict]" = []
    for results in result_lists:
        for r in results:
            cid = r.get("cid")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            out.append(r)
            if len(out) >= max_results:
                return out
    return out
