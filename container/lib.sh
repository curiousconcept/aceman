# container/lib.sh — shared shell helpers for the aceman wrappers.
#
# Sourced by aceman, aceman_web, container/engine/run-container.sh, and
# container/aceman-web/run-web-container.sh. One file keeps the
# WSL-detection regex, port/size validators, image-build flow, and
# shared-network plumbing in one place so the four wrappers can't drift
# apart on details that have to agree (e.g. "what counts as WSL", "is
# the engine image present", "what's the shared network called").
#
# Conventions:
#   * Every helper returns 0 on success and non-zero with a message on
#     stderr on failure. Callers under `set -e` propagate that.
#   * The shared $PROG variable (default "aceman") is prefixed onto
#     diagnostic messages so the user can tell which wrapper spoke.
#   * No state is mutated except where documented; sourcing this file
#     is side-effect free.

# ---- platform detection -------------------------------------------------

# True iff we're running under WSL. The kernel exposes a single string
# in /proc/sys/kernel/osrelease that includes "microsoft" or "WSL" on
# every supported WSL version. Cheaper than spawning `uname -r`.
is_wsl() {
    grep -qiE "microsoft|wsl" /proc/sys/kernel/osrelease 2>/dev/null
}

# Echo the first IPv4 address from `hostname -I` (the WSL guest IP in
# NAT mode). Returns 1 if hostname produced nothing — caller decides
# whether that's fatal.
wsl_guest_ip() {
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1; exit}')"
    [ -n "$ip" ] || return 1
    printf '%s' "$ip"
}

# ---- input validation ---------------------------------------------------

# Validate a TCP/UDP port number: integer in [1, 65535]. $2 is the
# label used in the error message. Echoes nothing; returns non-zero on
# bad input with a stderr message.
validate_port() {
    local val="$1" label="${2:-port}" prog="${PROG:-aceman}"
    [[ "$val" =~ ^[0-9]+$ ]] \
        || { echo "$prog: $label must be a number: $val" >&2; return 1; }
    [ "$val" -ge 1 ] && [ "$val" -le 65535 ] \
        || { echo "$prog: $label out of range (1-65535): $val" >&2; return 1; }
}

# Validate a podman-style size spec: digits with optional g/m/k suffix
# (case-insensitive). $2 is the label used in the error message.
validate_size_spec() {
    local val="$1" label="${2:-size}" prog="${PROG:-aceman}"
    [[ "$val" =~ ^[0-9]+[gGmMkK]?$ ]] \
        || { echo "$prog: $label must look like 3g / 512m / 1024k / bare bytes (got: $val)" >&2; return 1; }
}

# ---- image builds -------------------------------------------------------

# Build a podman image if it isn't already present. Internal helper —
# both ensure_engine_image and ensure_web_image route through this.
#
# Args:
#   $1 = image tag
#   $2 = build context dir (passed as `.` to podman after `cd`)
#   $3 = absolute path to the Containerfile
#   $4 = short label for messages ("engine", "web")
#   $5 = optional prerequisite file. If non-empty and the file is
#        absent, return 1 with a guidance message.
#   $6 = optional extra guidance line printed when $5 is missing.
#
# Returns 0 if podman is missing (caller is expected to require it
# elsewhere when actually needed) or if the image is already built.
_ensure_podman_image() {
    local tag="$1" ctx="$2" cf="$3" label="$4"
    local pre="${5:-}" pre_hint="${6:-}"
    local prog="${PROG:-aceman}"
    command -v podman >/dev/null || return 0
    if podman image exists "$tag" 2>/dev/null; then
        return 0
    fi
    [ -d "$ctx" ] || {
        echo "$prog: $label build context missing: $ctx" >&2; return 1; }
    [ -f "$cf" ] || {
        echo "$prog: $label Containerfile missing: $cf" >&2; return 1; }
    if [ -n "$pre" ] && [ ! -f "$pre" ]; then
        echo "$prog: $label prerequisite missing: $pre" >&2
        [ -n "$pre_hint" ] && echo "  $pre_hint" >&2
        return 1
    fi
    echo "$prog: building $label image '$tag' (first run only, ~2 min)..." >&2
    ( cd "$ctx" && podman build -t "$tag" -f "$cf" . ) >&2 || {
        echo "$prog: $label image build failed; see output above" >&2
        return 1
    }
}

# Ensure the engine container image is present. Caller must set
# $ACELIB_PROJECT_ROOT to the repo root (the dir containing
# container/engine/Containerfile). Image tag falls back to the
# project-wide default if unset.
ensure_engine_image() {
    local root="${ACELIB_PROJECT_ROOT:?ACELIB_PROJECT_ROOT must be set}"
    local tag="${ACE_IMAGE:-localhost/acestream:vetted}"
    local ctx="$root/container/engine"
    _ensure_podman_image \
        "$tag" "$ctx" "$ctx/Containerfile" "engine" \
        "$ctx/dist/engine.tar.gz" \
        "download from acestream.media and place it at the path above, then re-run."
}

# Ensure the web container image is present. Build context is the
# project root (Containerfile.web does `COPY web /app/web`).
ensure_web_image() {
    local root="${ACELIB_PROJECT_ROOT:?ACELIB_PROJECT_ROOT must be set}"
    local tag="${ACE_WEB_IMAGE:-localhost/aceman-web:vetted}"
    local cf="$root/container/aceman-web/Containerfile.web"
    _ensure_podman_image "$tag" "$root" "$cf" "web"
}

# ---- shared podman network ---------------------------------------------

# Create the shared user-defined bridge if it doesn't exist. Engine +
# web both join this network so the web reaches the engine at
# http://$ACE_NAME:6878 instead of via the host bridge gateway.
ensure_shared_network() {
    local net="${ACE_NETWORK:-aceman-net}"
    command -v podman >/dev/null || return 0
    if podman network exists "$net" 2>/dev/null; then
        return 0
    fi
    podman network create "$net" >/dev/null \
        || { echo "${PROG:-aceman}: failed to create podman network '$net'" >&2; return 1; }
}

# Attach an already-running container to the shared network if it
# isn't a member yet. Idempotent. Used during an in-place upgrade so a
# pre-existing engine on the old default bridge doesn't strand the web
# UI ("can't resolve http://ace").
attach_to_shared_network() {
    local container="$1" net="${ACE_NETWORK:-aceman-net}"
    [ -n "$container" ] || return 0
    command -v podman >/dev/null || return 0
    podman container exists "$container" 2>/dev/null || return 0
    if podman inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
            "$container" 2>/dev/null | grep -qw -- "$net"; then
        return 0
    fi
    podman network connect "$net" "$container" 2>/dev/null || true
}
