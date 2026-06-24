# Threat model

The Ace Stream engine is treated as an **untrusted input source**. Its
HTTP responses are size-capped, JSON-parsed strictly, URL-validated
(scheme forced to `http`, authority rewritten to the engine endpoint we
configured), and control bytes are scrubbed before anything is shown to
the user. The container runs with `cap-drop=ALL`, `no-new-privileges`, a
read-only rootfs, tmpfs scratch, memory + PID caps, and a
**loopback-only** port binding (no inbound NAT punch-through). See
[`container/engine/README.md`](../container/engine/README.md).

`search-ace.stream` is treated identically: server-side proxy,
HTTPS-only, allow-listed host, no off-domain redirects, JSON re-projected
into a minimal `{cid, name, translated_name}` shape with control-byte and
Unicode bidi-override stripping on names.

The **broker** is the host trust boundary: the web frontend can only ask
for a fixed allow-list of actions over a `0600` unix socket, and every
`podman` argv is hardcoded with the container name / image tag frozen at
startup — no request field reaches a command line. See
[`broker/README.md`](../broker/README.md).

## What it does not protect against

The container limits the blast radius **if** the engine binary
misbehaves, but does **not** protect against P2P deanonymisation — the
swarm still sees your IP via **outbound** connections. To reduce that,
route the engine's egress through a VPN sidecar (e.g. Gluetun).

Inbound is closed by default and needs no router-side action: no P2P port
is published to the host (`ACE_P2P_PORT` unset), and rootless Podman's
userspace NAT (slirp4netns / pasta) won't relay UPnP/NAT-PMP to your
router — so the engine cannot open its own inbound hole. If you opt into
`ACE_P2P_PORT`, you publish container port `8621` to a host port and take
on that inbound exposure deliberately.
