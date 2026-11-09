/* 用真实鼠标拖选 iframe 里的文字，并检查扩展隔离世界的状态。 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const URL = 'http://127.0.0.1:8765/test/fixtures/frames.html';
const PORT = 9339;
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'frames-real-' + Date.now()
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
      target = list.find((t) => t.type === 'page' && t.url.indexOf('frames.html') !== -1);
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
  const contexts = [];
  const exceptions = [];
  let seq = 0;

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.executionContextCreated') {
      contexts.push(msg.params.context);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
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

  async function evalJs(expression, contextId) {
    const params = { expression, returnByValue: true, awaitPromise: true };
    if (contextId) params.contextId = contextId;
    const res = await cmd('Runtime.evaluate', params);
    const result = res.result || {};
    if (result.exceptionDetails) {
      return { __error: result.exceptionDetails.text };
    }
    return result.result ? result.result.value : undefined;
  }

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Input.enable').catch(() => {});
  await sleep(1500);

  let box = '';
  for (let i = 0; i < 80; i += 1) {
    box = await evalJs(`(() => {
      const frame = document.getElementById('frame');
      if (!frame || !frame.contentDocument || !frame.contentDocument.body) return '';
      const doc = frame.contentDocument;
      if (doc.body.textContent.indexOf('iframe needle') === -1) return '';
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node = null, index = -1;
      while ((node = walker.nextNode())) {
        index = node.nodeValue.indexOf('iframe needle');
        if (index >= 0) break;
      }
      if (!node) return '';
      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 'iframe needle'.length);
      const rr = range.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      return JSON.stringify({
        x1: fr.left + (frame.clientLeft || 0) + rr.left + 2,
        x2: fr.left + (frame.clientLeft || 0) + rr.right - 2,
        y: fr.top + (frame.clientTop || 0) + rr.top + rr.height / 2
      });
    })()`);
    if (box) break;
    await sleep(300);
  }

  console.log('BOX ' + box);
  if (!box) {
    console.log('NO_BOX');
    killTree(child.pid);
    process.exit(1);
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

  await sleep(1400);

  const pageInfo = await evalJs(`(() => {
    const frame = document.getElementById('frame');
    const win = frame && frame.contentWindow;
    const top = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
    const fr = win && win.CSS && win.CSS.highlights ? win.CSS.highlights.get('sts-all') : null;
    return JSON.stringify({
      host: !!document.querySelector('[data-sts-host]'),
      top: top ? Array.from(top).length : -1,
      frame: fr ? Array.from(fr).length : -1,
      sel: String((win && win.getSelection()) || '')
    });
  })()`);

  console.log('PAGE ' + pageInfo);

  for (const ctx of contexts) {
    const state = await evalJs(
      `(() => {
        const dbg = window.__STS_DEBUG__;
        if (!dbg) return 'no-debug';
        let docs = -1, hasToken = false;
        try {
          const m = dbg.getMap();
          docs = m.docs ? m.docs.size : -1;
          hasToken = m.text.indexOf('iframe needle') !== -1;
        } catch (e) {
          return 'map-error ' + e.message;
        }
        return JSON.stringify({
          open: dbg.popup.isOpen(),
          items: dbg.popup.items.length,
          docs,
          hasToken
        });
      })()`,
      ctx.id
    );
    if (state && state !== 'no-debug' && state !== undefined) {
      console.log(
        'CTX ' + ctx.id + ' ' + (ctx.origin || '') + ' ' + (ctx.name || '') + ' => ' + state
      );
    }
  }

  console.log('EXCEPTIONS ' + JSON.stringify(exceptions.slice(0, 5)));

  ws.close();
  killTree(child.pid);
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
