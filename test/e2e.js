/* 端到端自测：模拟一次真实选区，走完 索引 -> 查找 -> 浮层 -> 高亮 -> 跳转 -> Esc。
 * 只有把 content.js 当普通页面脚本加载时才拿得到 __STS_DEBUG__。
 */
(function () {
  'use strict';

  const results = [];

  function ok(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  }

  function done() {
    const lines = results.map((r) => (r.ok ? 'PASS ' + r.name : 'FAIL ' + r.name + ' | ' + r.detail));
    const failed = results.filter((r) => !r.ok).length;
    lines.push(failed ? 'FAILURES ' + failed : 'ALL PASS ' + results.length);
    const out = document.getElementById('e2e-out');
    out.textContent = lines.join('\n');
    for (const line of lines) console.log(line);
  }

  function check() {
    const host = document.querySelector('[data-sts-host]');
    ok('host-created', !!host, host ? 'yes' : 'no');

    const all = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
    const allCount = all ? Array.from(all).length : -1;
    ok('all-highlight-3', allCount === 3, allCount);

    const dbg = window.__STS_DEBUG__;
    ok('debug-hook', !!dbg, dbg ? 'yes' : 'no');
    if (!dbg) return;

    ok('items-3', dbg.popup.items.length === 3, dbg.popup.items.length);

    const left = parseFloat(host.style.left);
    const top = parseFloat(host.style.top);
    ok(
      'panel-in-viewport',
      left >= 0 && top >= 0 && left < window.innerWidth && top < window.innerHeight,
      left + ',' + top
    );

    dbg.popup.move(1);
    ok('keyboard-active-0', dbg.popup.activeIndex === 0, dbg.popup.activeIndex);

    dbg.popup.activate();
    ok('active-highlight', !!(window.CSS && CSS.highlights && CSS.highlights.has('sts-active')), 'sts-active');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    ok('esc1-keeps-panel', !!document.querySelector('[data-sts-host]'), 'open');
    ok(
      'esc1-clears-active',
      !(window.CSS && CSS.highlights && CSS.highlights.has('sts-active')),
      'cleared'
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    ok('esc2-closes-panel', !document.querySelector('[data-sts-host]'), 'closed');
  }

  function phase2() {
    try {
      // 跨两个段落选择，选区里带换行；精确匹配会因块级哨兵失败，从而走近似兜底
      const q1 = document.getElementById('q1').firstChild;
      const q2 = document.getElementById('q2').firstChild;
      const range = document.createRange();
      range.setStart(q1, 0);
      range.setEnd(q2, q2.nodeValue.length);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 500, clientY: 320, button: 0 })
      );

      setTimeout(() => {
        try {
          const dbg = window.__STS_DEBUG__;
          ok('fallback-mode', !!(dbg && dbg.popup.mode === 'fallback'), dbg && dbg.popup.mode);
          ok('fallback-items', !!(dbg && dbg.popup.items.length >= 1), dbg && dbg.popup.items.length);

          const all = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
          ok(
            'fallback-highlight',
            !!(all && Array.from(all).length >= 1),
            all && Array.from(all).length
          );
        } catch (err) {
          ok('e2e-phase2', false, err && err.message);
        }
        phase3();
      }, 900);
    } catch (err) {
      ok('e2e-phase2-setup', false, err && err.message);
      done();
    }
  }

  function phase3() {
    try {
      // 整句题干本身就在页面里：精确匹配只会命中「它自己」，应改走近似兜底
      const q = document.getElementById('q3').firstChild;
      const range = document.createRange();
      range.setStart(q, 0);
      range.setEnd(q, q.nodeValue.length);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 520, clientY: 340, button: 0 })
      );

      setTimeout(() => {
        try {
          const dbg = window.__STS_DEBUG__;
          ok('self-only-fallback', !!(dbg && dbg.popup.mode === 'fallback'), dbg && dbg.popup.mode);
          ok('self-only-items-3', !!(dbg && dbg.popup.items.length === 3), dbg && dbg.popup.items.length);

          const q3 = document.getElementById('q3');
          const inside = !!(dbg && dbg.popup.items.some((it) => q3.contains(it.range.startContainer)));
          ok('self-excluded', !inside, inside);
        } catch (err) {
          ok('e2e-phase3', false, err && err.message);
        }
        phase4();
      }, 900);
    } catch (err) {
      ok('e2e-phase3-setup', false, err && err.message);
      done();
    }
  }

  function phase4() {
    try {
      // 只出现一次的词：兜底给不出别的，应保留「找到 1 处」
      const node = document.getElementById('q3').firstChild;
      const word = 'paragraph';
      const at = node.nodeValue.indexOf(word);
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 540, clientY: 360, button: 0 })
      );

      setTimeout(() => {
        try {
          const dbg = window.__STS_DEBUG__;
          ok('unique-word-exact', !!(dbg && dbg.popup.mode === 'exact'), dbg && dbg.popup.mode);
          ok('unique-word-items', !!(dbg && dbg.popup.items.length === 1), dbg && dbg.popup.items.length);
        } catch (err) {
          ok('e2e-phase4', false, err && err.message);
        }
        done();
      }, 900);
    } catch (err) {
      ok('e2e-phase4-setup', false, err && err.message);
      done();
    }
  }

  setTimeout(() => {
    try {
      const target = document.getElementById('dup1').firstChild;
      const range = document.createRange();
      range.setStart(target, 0);
      range.setEnd(target, 4); // 只选「重复文本」，不含后面的 A

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 400, clientY: 300, button: 0 })
      );

      setTimeout(() => {
        try {
          check();
        } catch (err) {
          ok('e2e-exception', false, err && err.message);
        }
        phase2();
      }, 800);
    } catch (err) {
      ok('e2e-setup', false, err && err.message);
      done();
    }
  }, 100);
})();
