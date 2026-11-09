/* 页面悬停回归：所有命中浅色；鼠标移到某处命中时只加深那一处；移开恢复。
 * 用法：node test/hover-cdp.js
 * 需要 8765 上的本地服务。
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8765/test/fixtures/hover.html';
const PORT = Number(process.env.STS_CDP_PORT || 9342);
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'hover-cdp-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (err) {
    // 已退出
  }
}

(async () => {
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crashpad',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      URL
    ],
    { stdio: 'ignore', detached: true }
  );
  child.unref();

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
      target = list.find((t) => t.type === 'page' && t.url.indexOf('hover.html') !== -1);
      if (target) break;
    } catch (err) {
      // 还没起来
    }
    await sleep(300);
  }

  if (!target) {
    console.log('NO_TARGET');
    killTree(child.pid);
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  await new Promise((resolve) => ws.addEventListener('open', resolve));

  function cmd(method, params) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  await cmd('Runtime.enable');
  await sleep(700);

  const result = await cmd('Runtime.evaluate', {
    expression: `(async () => {
      if (!window.__STS_DEBUG__) return JSON.stringify({ error: 'no debug hook' });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const needle = 'hoverword';
      const p1 = document.getElementById('p1').firstChild;
      const p2 = document.getElementById('p2').firstChild;

      const range = document.createRange();
      range.setStart(p1, 0);
      range.setEnd(p1, needle.length);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, clientX: 200, clientY: 60, button: 0
      }));

      await sleep(900);
      const dbg = window.__STS_DEBUG__;
      const items = dbg.popup.items || [];

      const second = document.createRange();
      second.setStart(p2, 0);
      second.setEnd(p2, needle.length);
      const rect = second.getBoundingClientRect();

      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: rect.left + 4,
        clientY: rect.top + rect.height / 2
      }));
      await sleep(200);

      const active = CSS.highlights.get('sts-active');
      const activeRange = active ? Array.from(active)[0] : null;
      const activeText = activeRange ? activeRange.toString() : '';
      const activeIsSecond = !!(activeRange && activeRange.startContainer === p2);

      const allAfterHover = CSS.highlights.get('sts-all')
        ? Array.from(CSS.highlights.get('sts-all')).length
        : -1;

      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: 700, clientY: 1000
      }));
      await sleep(200);
      const afterLeave = !!CSS.highlights.get('sts-active');
      const allAfterLeave = CSS.highlights.get('sts-all')
        ? Array.from(CSS.highlights.get('sts-all')).length
        : -1;

      dbg.highlighter.setTheme('blue');
      const css = Array.from(document.adoptedStyleSheets || [])
        .map((s) => {
          try {
            return Array.from(s.cssRules).map((r) => r.cssText).join('');
          } catch (e) {
            return '';
          }
        })
        .join('');
      const blueInjected = css.indexOf('80, 170, 255') !== -1;
      dbg.highlighter.setTheme('amber');

      return JSON.stringify({
        items: items.length,
        activeText: activeText,
        activeIsSecond: activeIsSecond,
        allAfterHover: allAfterHover,
        afterLeave: afterLeave,
        allAfterLeave: allAfterLeave,
        blueInjected: blueInjected
      });
    })()`,
    returnByValue: true,
    awaitPromise: true
  });

  const value =
    result.result && result.result.result && result.result.result.value
      ? result.result.result.value
      : '';

  console.log('INFO ' + value);

  let pass = false;
  try {
    const data = JSON.parse(value);
    pass = !!(
      data.items === 3 &&
      data.activeText === 'hoverword' &&
      data.activeIsSecond &&
      data.allAfterHover === 3 &&
      !data.afterLeave &&
      data.allAfterLeave === 3 &&
      data.blueInjected
    );
  } catch (err) {
    pass = false;
  }

  console.log(pass ? 'PASS hover-and-theme' : 'FAIL hover-and-theme');

  ws.close();
  killTree(child.pid);
  process.exit(pass ? 0 : 1);
})();
