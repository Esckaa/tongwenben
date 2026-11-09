/* 真实扩展环境下的同源 iframe 测试：扩展只注入顶层，但应把 iframe 文本并入索引。 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const URL = 'http://127.0.0.1:8765/test/fixtures/frames.html';
const PORT = 9338;
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'frames-ext-' + Date.now()
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
  const exceptions = [];
  let seq = 0;

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
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

  async function evalJs(expression) {
    const res = await cmd('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    const result = res.result || {};
    if (result.exceptionDetails) {
      return { __error: result.exceptionDetails.text };
    }
    return result.result ? result.result.value : undefined;
  }

  await cmd('Runtime.enable');

  let info = '';
  for (let i = 0; i < 120; i += 1) {
    info = await evalJs(`(async () => {
      const frame = document.getElementById('frame');
      if (!frame || !frame.contentDocument || !frame.contentDocument.body) return '';
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      const token = 'iframe needle';
      if (doc.body.textContent.indexOf(token) === -1) return '';

      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node = null, index = -1;
      while ((node = walker.nextNode())) {
        index = node.nodeValue.indexOf(token);
        if (index >= 0) break;
      }
      if (!node) return '';

      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + token.length);
      const sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new win.MouseEvent('mouseup', {
        bubbles: true, clientX: 120, clientY: 80, button: 0
      }));

      await new Promise((r) => setTimeout(r, 1000));
      const top = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
      const fr = win.CSS && win.CSS.highlights ? win.CSS.highlights.get('sts-all') : null;
      return JSON.stringify({
        host: !!document.querySelector('[data-sts-host]'),
        top: top ? Array.from(top).length : -1,
        frame: fr ? Array.from(fr).length : -1
      });
    })()`);

    if (info && info !== '') break;
    await sleep(300);
  }

  console.log('INFO ' + info);
  console.log('EXCEPTIONS ' + JSON.stringify(exceptions.slice(0, 5)));

  ws.close();
  killTree(child.pid);
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
