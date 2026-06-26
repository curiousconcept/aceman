// App-wide runtime flags, resolved once at bootstrap from
// /api/storage-mode and then read across the app. Business-agnostic:
// they describe the storage backend and the host environment, not any
// feature. Single-writer — only the bootstrap calls the setters; every
// other module imports the live `mode` / `isWslMode` bindings read-only.

// 'sqlite' | 'browser' — which favourites/history store the server has.
export let mode = 'browser';
export function setMode(value) { mode = value; }

// WSL mode: the page is served from a Linux WSL distro to a Windows
// browser via the WSL guest IP. When true, Linux-desktop-only UI (the
// App-launcher card + acestream:// scheme handler) is hidden — none of
// it can take effect from a Windows browser session.
export let isWslMode = false;
export function setWslMode(value) { isWslMode = value; }
