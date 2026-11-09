/* 生成商店截图（1280×800）：主面板、悬停变深、设置页、PDF 阅读器。
 * 前置：node test/serve.js 8765
 * 运行：node store/capture.js
 */
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const PDF = path.join(ROOT, 'test', 'fixtures', 'sample.pdf');
const OUT = path.join(__dirname, 'screenshots');
const PORT = Number(process.env.STS_CDP_PORT || 9346);
const PROFILE = path.resolve(
  ROOT,
  '..',
  '..',
  '.dsh',
  'tmp',
  'store-capture-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idOf(p) {
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crashpad',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--window-size=1280,800',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--load-extension=' + EXT,
      '--disable-extensions-except=' + EXT,
      'about:blank'
    ],
    { stdio: 'ignore', detached: true }
  );
  child.unref();

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
      target = list.find((t) => t.type === 'page');
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result ? result.result.value : undefined;
  }

  async function waitReady() {
    for (let i = 0; i < 80; i += 1) {
      const state = await evalJs('document.readyState');
      if (state === 'complete') return;
      await sleep(150);
    }
  }

  async function nav(url) {
    await cmd('Page.navigate', { url });
    await sleep(700);
    await waitReady();
    await sleep(700);
  }

  async function shot(name) {
    const res = await cmd('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
    console.log('SHOT ' + file);
  }

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('DOM.enable');
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cmd('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });

  const id = idOf(EXT);
  console.log('EXT_ID ' + id);

  // 1) 设置页：选蓝色
  await nav('chrome-extension://' + id + '/options.html');
  const clicked = await evalJs(`(() => {
    const blue = document.querySelector('[data-accent="blue"]');
    if (!blue) return false;
    blue.click();
    return true;
  })()`);
  if (!clicked) throw new Error('blue swatch not found');
  await sleep(500);
  await shot('03-options.png');

  // 2) 演示页：选中题目里的“人工智能”
  await nav('http://127.0.0.1:8765/store/demo.html');
  const sel = await evalJs(`(() => {
    const root = document.getElementById('question');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = null;
    let at = -1;
    while ((node = walker.nextNode())) {
      at = node.nodeValue.indexOf('人工智能');
      if (at >= 0) break;
    }
    if (!node || at < 0) return 'not-found';
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 4);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const rect = range.getBoundingClientRect();
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0
    }));
    return JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) });
  })()`);
  if (sel === 'not-found') throw new Error('question phrase not found');
  await sleep(1200);
  await shot('01-panel.png');

  // 3) 悬停文章里的第二处命中，变深
  await evalJs(`(() => {
    const root = document.querySelector('article');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    let node = null;
    while ((node = walker.nextNode())) {
      let at = 0;
      while ((at = node.nodeValue.indexOf('人工智能', at)) !== -1) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 4);
        hits.push(range);
        at += 4;
      }
    }
    if (hits.length < 2) return false;
    const rect = hits[1].getBoundingClientRect();
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.left + Math.min(30, rect.width / 2),
      clientY: rect.top + rect.height / 2
    }));
    return true;
  })()`);
  await sleep(500);
  await shot('02-hover.png');

  // 4) PDF 阅读器
  await nav('chrome-extension://' + id + '/pdf-viewer.html');
  await sleep(800);

  const doc = await cmd('DOM.getDocument', { depth: 0 });
  const rootId = doc.result.root.nodeId;
  const input = await cmd('DOM.querySelector', { nodeId: rootId, selector: '#file' });
  if (!input.result || !input.result.nodeId) throw new Error('pdf file input missing');

  await cmd('DOM.setFileInputFiles', {
    nodeId: input.result.nodeId,
    files: [PDF]
  });

  for (let i = 0; i < 120; i += 1) {
    const ready = await evalJs('!!(window.__PDF_VIEWER__ && window.__PDF_VIEWER__.ready)');
    if (ready) break;
    await sleep(250);
  }
  await sleep(900);

  const pdfSel = await evalJs(`(() => {
    const pages = document.getElementById('pages');
    const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
    let node = null;
    let at = -1;
    while ((node = walker.nextNode())) {
      at = node.nodeValue.indexOf('PDFTEST');
      if (at >= 0) break;
    }
    if (!node || at < 0) return 'not-found';
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 7);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const rect = range.getBoundingClientRect();
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0
    }));
    return 'ok';
  })()`);
  if (pdfSel === 'not-found') throw new Error('PDFTEST not found');
  await sleep(1200);
  await shot('04-pdf.png');

  ws.close();
  killTree(child.pid);
  console.log('DONE');
})().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
