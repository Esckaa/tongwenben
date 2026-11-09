/* 在真实扩展环境里验证 PDF 阅读页：
 *   1. 加载扩展，打开 chrome://extensions 拿到扩展 ID；
 *   2. 跳到 chrome-extension://<id>/pdf-viewer.html；
 *   3. 通过 DOM.setFileInputFiles 塞入 sample.pdf；
 *   4. 等渲染完成后选中 PDFTEST，检查浮层与高亮。
 */
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const PDF = path.resolve(__dirname, 'fixtures', 'sample.pdf');
const PORT = Number(process.env.STS_CDP_PORT || 9334);
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'pdf-ext-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extIdOf(p) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(p, 'utf16le'))
    .digest('hex')
    .slice(0, 32)
    .split('')
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (err) {
    // 已退出
  }
}

async function main() {
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crashpad',
    '--disable-breakpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--load-extension=' + EXT,
    '--disable-extensions-except=' + EXT,
    'about:blank'
  ];

  const child = spawn(EDGE, args, { stdio: 'ignore', detached: true });
  child.unref();

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json');
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
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
  await cmd('Page.enable');

  const id = extIdOf(EXT);
  console.log('EXT_ID ' + id);

  await cmd('Page.navigate', {
    url: 'chrome-extension://' + id + '/pdf-viewer.html'
  });
  await sleep(2500);

  const doc = await cmd('DOM.getDocument', { depth: 0 });
  const rootId = doc.result.root.nodeId;
  const input = await cmd('DOM.querySelector', { nodeId: rootId, selector: '#file' });

  if (!input.result || !input.result.nodeId) {
    console.log('NO_FILE_INPUT');
    ws.close();
    killTree(child.pid);
    process.exit(1);
  }

  await cmd('DOM.setFileInputFiles', {
    nodeId: input.result.nodeId,
    files: [PDF]
  });

  let ready = false;
  for (let i = 0; i < 240; i += 1) {
    ready = !!(await evalJs('!!(window.__PDF_VIEWER__ && window.__PDF_VIEWER__.ready)'));
    if (ready) break;
    await sleep(250);
  }

  await sleep(1000);

  const info = await evalJs(`(async () => {
    const pages = document.getElementById('pages');
    const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
    let node = null, index = -1;
    while ((node = walker.nextNode())) {
      index = node.nodeValue.indexOf('PDFTEST');
      if (index >= 0) break;
    }
    if (!node || index < 0) return JSON.stringify({ error: 'token not found' });

    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 7);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 400, clientY: 300, button: 0 }));

    await new Promise((r) => setTimeout(r, 900));
    const all = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
    return JSON.stringify({
      ready: !!(window.__PDF_VIEWER__ && window.__PDF_VIEWER__.ready),
      pages: window.__PDF_VIEWER__ ? window.__PDF_VIEWER__.rendered : -1,
      pageNodes: document.querySelectorAll('.pdf-page').length,
      textLayers: document.querySelectorAll('.textLayer').length,
      host: !!document.querySelector('[data-sts-host]'),
      all: all ? Array.from(all).length : -1
    });
  })()`);

  console.log('INFO ' + info);
  console.log('EXCEPTIONS ' + JSON.stringify(exceptions.slice(0, 5)));

  ws.close();
  killTree(child.pid);
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
