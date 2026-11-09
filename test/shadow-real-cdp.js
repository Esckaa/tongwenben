/* 真实鼠标在 shadow DOM 里拖选，检查 document / shadowRoot 各自能拿到什么选区。 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const URL = 'http://127.0.0.1:8765/test/fixtures/shadow.html';
const PORT = 9342;
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'shadow-real-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (err) {
    // 已退出
  }
}

async function main() {
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
      '--load-extension=' + EXT,
      '--disable-extensions-except=' + EXT,
      URL
    ],
    { stdio: 'ignore', detached: true }
  );
  child.unref();

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
      target = list.find((t) => t.type === 'page' && t.url.indexOf('shadow.html') !== -1);
      if (target) break;
    } catch (err) {
      // 等
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

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  function cmd(method, params) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async function evalJs(expression) {
    const res = await cmd('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    const result = res.result || {};
    if (result.exceptionDetails) return '';
    return result.result ? result.result.value : '';
  }

  await cmd('Runtime.enable');
  await sleep(1500);

  const box = await evalJs(`(() => {
    const host = document.getElementById('host');
    const root = host && host.shadowRoot;
    if (!root) return '';
    const p = root.getElementById('s1');
    if (!p) return '';
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node = null, index = -1;
    while ((node = walker.nextNode())) {
      index = node.nodeValue.indexOf('shadow needle');
      if (index >= 0) break;
    }
    if (!node) return '';
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 'shadow needle'.length);
    const rr = range.getBoundingClientRect();
    return JSON.stringify({ x1: rr.left + 2, x2: rr.right - 2, y: rr.top + rr.height / 2 });
  })()`);

  console.log('BOX ' + box);
  if (!box) {
    console.log('NO_BOX');
    killTree(child.pid);
    return;
  }

  const b = JSON.parse(box);

  await cmd('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: b.x1, y: b.y, button: 'left', buttons: 1, clickCount: 1
  });
  await sleep(60);
  for (let i = 1; i <= 4; i += 1) {
    await cmd('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: b.x1 + ((b.x2 - b.x1) * i) / 4,
      y: b.y,
      button: 'left',
      buttons: 1
    });
    await sleep(40);
  }
  await cmd('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: b.x2, y: b.y, button: 'left', buttons: 0, clickCount: 1
  });

  await sleep(1200);

  const info = await evalJs(`(() => {
    const host = document.getElementById('host');
    const root = host && host.shadowRoot;
    const ds = document.getSelection();
    let rs = null;
    try { rs = root && root.getSelection ? root.getSelection() : null; } catch (e) {}
    const all = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
    return JSON.stringify({
      docSel: ds ? ds.toString() : null,
      docAnchor: ds && ds.anchorNode
        ? (ds.anchorNode.nodeType + ':' + String(ds.anchorNode.nodeValue || ds.anchorNode.tagName || '').slice(0, 40))
        : null,
      rootApi: !!(root && root.getSelection),
      rootSel: rs ? rs.toString() : null,
      host: !!document.querySelector('[data-sts-host]'),
      all: all ? Array.from(all).length : -1
    });
  })()`);

  console.log('INFO ' + info);

  ws.close();
  killTree(child.pid);
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
