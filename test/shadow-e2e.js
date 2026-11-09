/* Shadow DOM 端到端：shadow 内选区、slot 投影、跨影子高亮、折叠/隐藏目标诊断。 */
(function () {
  'use strict';

  const results = [];
  const out = document.getElementById('out');

  function ok(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  }

  function done() {
    const lines = results.map((r) => (r.ok ? 'PASS ' + r.name : 'FAIL ' + r.name + ' | ' + r.detail));
    const failed = results.filter((r) => !r.ok).length;
    lines.push(failed ? 'FAILURES ' + failed : 'ALL PASS ' + results.length);
    out.textContent = lines.join('\n');
    for (const line of lines) console.log(line);
  }

  function diagnoseTargets() {
    const dbg = window.__STS_DEBUG__;
    if (!dbg) return;

    const det = document.getElementById('det');
    const collapsedNode = det.querySelector('#collapsed').firstChild;
    const collapsedRange = document.createRange();
    collapsedRange.setStart(collapsedNode, 0);
    collapsedRange.setEnd(collapsedNode, collapsedNode.nodeValue.length);

    const diag = dbg.diagnoseTarget(collapsedRange);
    ok('diagnose-details', !!(diag && diag.kind === 'details'), diag && diag.kind);

    const jump = dbg.jumpTo(collapsedRange);
    ok('details-opened', det.open === true, det.open);
    ok('details-jump-ok', !!(jump && jump.ok === true), jump && jump.note);

    const hiddenNode = document.getElementById('hiddenText').firstChild;
    const hiddenRange = document.createRange();
    hiddenRange.setStart(hiddenNode, 0);
    hiddenRange.setEnd(hiddenNode, hiddenNode.nodeValue.length);

    const hiddenDiag = dbg.diagnoseTarget(hiddenRange);
    ok('diagnose-hidden', !!(hiddenDiag && hiddenDiag.kind === 'hidden'), hiddenDiag && hiddenDiag.kind);

    const hiddenJump = dbg.jumpTo(hiddenRange);
    ok('hidden-jump-false', !!(hiddenJump && hiddenJump.ok === false), hiddenJump && hiddenJump.note);
  }

  function start() {
    try {
      const host = document.getElementById('host');
      const root = host.shadowRoot;
      const paragraph = root.getElementById('s1');
      const node = paragraph.firstChild;
      const index = node.nodeValue.indexOf('shadow needle');

      if (index < 0) {
        ok('token-found', false, 'no token');
        done();
        return;
      }

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 'shadow needle'.length);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          composed: true,
          clientX: 400,
          clientY: 300,
          button: 0
        })
      );

      setTimeout(() => {
        try {
          const dbg = window.__STS_DEBUG__;
          const all = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;

          ok('host-created', !!document.querySelector('[data-sts-host]'), 'host');
          ok('items-4', !!(dbg && dbg.popup.items.length === 4), dbg && dbg.popup.items.length);
          ok('highlight-4', !!(all && Array.from(all).length === 4), all && Array.from(all).length);
          ok(
            'shadow-style-injected',
            !!(root.adoptedStyleSheets && root.adoptedStyleSheets.length > 0),
            root.adoptedStyleSheets.length
          );

          const shadowIndex = dbg
            ? dbg.popup.items.findIndex(
                (it) => it.range.startContainer.getRootNode() === root
              )
            : -1;
          ok('has-shadow-item', shadowIndex >= 0, shadowIndex);

          if (shadowIndex >= 0) {
            dbg.popup.setActive(shadowIndex, false);
            dbg.popup.activate();
          }

          ok(
            'active-highlight',
            !!(window.CSS && CSS.highlights && CSS.highlights.has('sts-active')),
            'active'
          );
        } catch (err) {
          ok('exception', false, err && err.message);
        }

        try {
          diagnoseTargets();
        } catch (err) {
          ok('diagnose-exception', false, err && err.message);
        }

        done();
      }, 900);
    } catch (err) {
      ok('setup', false, err && err.message);
      done();
    }
  }

  setTimeout(start, 200);
})();
