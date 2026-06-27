# Vendored third-party assets

Files bundled here are static, version-pinned, and served by the web app
under `/static/<name>` (allow-listed in `web/aceman_web.py:_STATIC_FILES`).
They aren't installed as system packages; the project ships them in-tree
so a fresh clone works without an extra package-manager step.

Every file is paired with a `<name>.sha256` line in `sha256sum(1)` format.
Verify the entire directory at any time with:

```sh
cd web/vendor && sha256sum -c mpegts.min.js.sha256
```

`-c` reads the hash file, recomputes the local file's hash, and prints
`OK` per line if they match (non-zero exit otherwise — useful in CI).

To re-fetch from upstream and re-check yourself, follow the per-file
instructions below.

---

## mpegts.min.js

Used by the in-browser playback path (`playback_mode = "browser"` in the
web UI). The library transmuxes MPEG-TS chunks served by `/api/stream/proxy/`
into fMP4 and feeds them to the browser's Media Source Extensions, so the
`<video>` element can play the engine's stream without a native player.

| Field            | Value                                                              |
|------------------|--------------------------------------------------------------------|
| Package          | [`mpegts.js`](https://github.com/xqq/mpegts.js)                    |
| Version pinned   | **1.8.0**                                                          |
| Upstream URL     | https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js        |
| Mirror           | https://unpkg.com/mpegts.js@1.8.0/dist/mpegts.js                   |
| Local filename   | `mpegts.min.js` (renamed from `mpegts.js` — upstream ships the minified build under that filename) |
| License          | Apache-2.0 (see headers inside the file)                           |
| Size             | 272 955 bytes                                                       |
| SHA-256          | `e998f7a6cec5fcab56ac14e8c22d61a42565c1ebf7174b3fda078343eda6cab0` |

### Re-download and verify

```sh
cd web/vendor
curl -sSL https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js \
    -o mpegts.min.js
sha256sum -c mpegts.min.js.sha256
```

If you want to bump to a newer release: fetch the new tarball, replace
the file, regenerate the hash with `sha256sum mpegts.min.js > mpegts.min.js.sha256`,
and update the version row in this README. The `<script src=>` in
`web/ui/index.html` doesn't need to change — it references the
allow-list key, not the upstream version.
