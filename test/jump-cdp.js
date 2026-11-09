/* 跳转回归：大容器 + 内层滚动区，验证跳转对准的是命中文字而不是容器。
 * 用法：node test/jump-cdp.js
 * 需要 8765 上的本地服务。
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8765/test/fixtures/jump.html';
const PORT = Number(process.env.STS_CDP_PORT || 9341);
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'jump-cdp-' + Date.now()
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
      target = list.find((t) => t.type === 'page' && t.url.indexOf('jump.html') !== -1);
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
  await sleep(600);

  const result = await cmd('Runtime.evaluate', {
    expression: `(async () => {
      if (!window.__STS_DEBUG__) return JSON.stringify({ error: 'no debug hook' });

      const scroller = document.getElementById('scroller');
      scroller.scrollTop = 2600;

      const walker = document.createTreeWalker(document.getElementById('doc'), NodeFilter.SHOW_TEXT);
      let passageText = null;
      let node = null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.indexOf('protected natural areas') !== -1) {
          passageText = node;
          break;
        }
      }
      if (!passageText) return JSON.stringify({ error: 'passage text not found' });

      const q = document.getElementById('question').firstChild;
      const needle = 'protected natural areas';
      const at = q.nodeValue.indexOf(needle);
      const range = document.createRange();
      range.setStart(q, at);
      range.setEnd(q, at + needle.length);

      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, clientX: 400, clientY: 320, button: 0
      }));

      await new Promise((r) => setTimeout(r, 800));

      const dbg = window.__STS_DEBUG__;
      const items = dbg.popup.items || [];
      const item = items.find((it) => it.range && it.range.startContainer === passageText);
      if (!item) return JSON.stringify({ error: 'passage item not found', count: items.length });

      const before = Math.round(scroller.scrollTop);
      const jump = dbg.jumpTo(item.range);
      await new Promise((r) => setTimeout(r, 900));

      const rect = item.range.getBoundingClientRect();
      return JSON.stringify({
        found: true,
        ok: !!(jump && jump.ok),
        before: before,
        after: Math.round(scroller.scrollTop),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        innerHeight: window.innerHeight,
        visible: rect.top >= 0 && rect.bottom <= window.innerHeight
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
    pass = !!(data.found && data.ok && data.visible && data.top >= 0);
  } catch (err) {
    pass = false;
  }

  console.log(pass ? 'PASS jump-visible' : 'FAIL jump-visible');

  ws.close();
  killTree(child.pid);
  process.exit(pass ? 0 : 1);
})();
