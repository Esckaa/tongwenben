/* 同源 iframe 端到端：在 iframe 里选中文本，检查顶层浮层、跨文档高亮与跳转。 */
(function () {
  'use strict';

  const results = [];
  const out = document.getElementById('out');
  const frame = document.getElementById('frame');

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

  function start() {
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !doc.body) {
        ok('iframe-accessible', false, 'no contentDocument');
        done();
        return;
      }

      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node = null;
      let index = -1;
      while ((node = walker.nextNode())) {
        index = node.nodeValue.indexOf('iframe needle');
        if (index >= 0) break;
      }

      if (!node || index < 0) {
        ok('token-found', false, 'no iframe needle');
        done();
        return;
      }

      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 'iframe needle'.length);

      const sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      doc.dispatchEvent(
        new win.MouseEvent('mouseup', {
          bubbles: true,
          clientX: 120,
          clientY: 80,
          button: 0
        })
      );

      setTimeout(() => {
        try {
          const dbg = window.__STS_DEBUG__;
          const host = document.querySelector('[data-sts-host]');
          const allTop = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
          const allFrame = win.CSS && win.CSS.highlights ? win.CSS.highlights.get('sts-all') : null;

          ok('host-created', !!host, host ? 'yes' : 'no');
          ok('items-3', dbg && dbg.popup.items.length === 3, dbg && dbg.popup.items.length);
          ok('top-highlight-1', !!(allTop && Array.from(allTop).length === 1), allTop && Array.from(allTop).length);
          ok('frame-highlight-2', !!(allFrame && Array.from(allFrame).length === 2), allFrame && Array.from(allFrame).length);

          const frameIndex = dbg
            ? dbg.popup.items.findIndex((it) => it.range.startContainer.ownerDocument === doc)
            : -1;
          ok('has-frame-item', frameIndex >= 0, frameIndex);

          if (frameIndex >= 0) {
            dbg.popup.setActive(frameIndex, false);
            dbg.popup.activate();
          }

          ok(
            'active-in-frame',
            !!(win.CSS && win.CSS.highlights && win.CSS.highlights.has('sts-active')),
            'frame active'
          );
          ok(
            'active-not-in-top',
            !(window.CSS && CSS.highlights && CSS.highlights.has('sts-active')),
            'top clean'
          );
        } catch (err) {
          ok('exception', false, err && err.message);
        }
        done();
      }, 900);
    } catch (err) {
      ok('setup', false, err && err.message);
      done();
    }
  }

  // 初始 about:blank 的 readyState 也是 complete，不能只看它；等真实内容出现
  let tries = 0;
  (function waitReady() {
    tries += 1;
    try {
      const doc = frame.contentDocument;
      if (doc && doc.body && doc.body.textContent.indexOf('iframe needle') >= 0) {
        start();
        return;
      }
    } catch (err) {
      // 还在加载
    }

    if (tries > 60) {
      ok('iframe-loaded', false, 'timeout');
      done();
      return;
    }
    setTimeout(waitReady, 100);
  })();
})();
