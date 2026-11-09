/* 用 CDP 在真实时间里打开 PDF 阅读页，验证渲染、文字层与检索。
 * 用法：node test/pdf-cdp.js [url]
 * 需要本机 Edge；脚本自己拉起无头浏览器，结束后 taskkill 掉。
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL =
  process.argv[2] ||
  'http://127.0.0.1:8765/extension/pdf-viewer.html?pdf=../test/fixtures/sample.pdf&test=1';
const PORT = Number(process.env.STS_CDP_PORT || 9333);
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'pdf-cdp-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (err) {
    // 已经退出
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
    URL
  ];

  const child = spawn(EDGE, args, { stdio: 'ignore', detached: true });
  child.unref();

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json');
      const list = await res.json();
      target = list.find((t) => t.type === 'page' && t.url.indexOf('pdf-viewer') !== -1);
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

  let ready = false;
  for (let i = 0; i < 240; i += 1) {
    ready = !!(await evalJs('!!(window.__PDF_VIEWER__ && window.__PDF_VIEWER__.ready)'));
    if (ready) break;
    await sleep(250);
  }

  await sleep(1500);

  const info = await evalJs(`JSON.stringify({
    ready: !!(window.__PDF_VIEWER__ && window.__PDF_VIEWER__.ready),
    pages: window.__PDF_VIEWER__ ? window.__PDF_VIEWER__.rendered : -1,
    pageNodes: document.querySelectorAll('.pdf-page').length,
    textLayers: document.querySelectorAll('.textLayer').length,
    testOut: (document.getElementById('test-out') || {}).textContent || '',
    host: !!document.querySelector('[data-sts-host]'),
    highlights: (window.CSS && CSS.highlights && CSS.highlights.get('sts-all'))
      ? Array.from(CSS.highlights.get('sts-all')).length : -1
  })`);

  console.log('INFO ' + info);
  console.log('EXCEPTIONS ' + JSON.stringify(exceptions.slice(0, 5)));

  ws.close();
  killTree(child.pid);
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
