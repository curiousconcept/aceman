// Diagnostics domain: a hidden dev overlay. Type d→b→g (outside any
// input) to flash viewport size + build/commit for 3 s and copy it to the
// clipboard — useful when reporting a layout issue or confirming a build.
export function initDiagnostics() {
  const SEQ = 'dbg';
  let buf = '', timer = null, hideTimer = null;
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    clearTimeout(timer);
    buf += e.key.toLowerCase();
    buf = buf.slice(-SEQ.length);
    if (buf === SEQ) {
      buf = '';
      const el = document.getElementById('dbg-overlay');
      if (!el) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const bw = document.body.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      // Two server-injected markers:
      //   build  — content hash of the served page + web backend (.py);
      //            the version signal, independent of podman.
      //   commit — git SHA (+ dirty); may be empty without meaning the
      //            build is wrong, hence a separate field.
      // NOTE: never reference the literal injection sentinels here — the
      // server's page-wide replace would clobber them and break the guard.
      const build = el.dataset.build || '';
      const commit = el.dataset.commit || '';
      const text = `${vw} x ${vh}px  body ${bw}px  DPR ${dpr}`
        + (build ? `  build ${build}` : '')
        + (commit ? `  commit ${commit}` : '');
      el.innerHTML =
        `${vw} &times; ${vh}px &nbsp;&#183;&nbsp; body&nbsp;${bw}px &nbsp;&#183;&nbsp; DPR&nbsp;${dpr}`
        + (build ? ` &nbsp;&#183;&nbsp; build&nbsp;${build}` : '')
        + (commit ? ` &nbsp;&#183;&nbsp; commit&nbsp;${commit}` : '');
      el.classList.add('visible');
      clearTimeout(hideTimer);
      navigator.clipboard.writeText(text).catch(() => {});
      hideTimer = setTimeout(() => el.classList.remove('visible'), 3000);
      return;
    }
    timer = setTimeout(() => { buf = ''; }, 1500);
  });
}
