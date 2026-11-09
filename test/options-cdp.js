/* 设置页色板自测：6 个色系、点蓝色后写入 storage、预览变量同步。 */
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const PORT = Number(process.env.STS_CDP_PORT || 9343);
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'options-cdp-' + Date.now()
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

  await new Promise((resolve) => ws.addEventListener('open', resolve));

  function cmd(method, params) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.navigate', {
    url: 'chrome-extension://' + idOf(EXT) + '/options.html'
  });
  await sleep(1500);

  const result = await cmd('Runtime.evaluate', {
    expression: `(async () => {
      const swatches = document.querySelectorAll('.swatch');
      const blue = document.querySelector('[data-accent="blue"]');
      if (blue) blue.click();
      await new Promise((r) => setTimeout(r, 400));
      const accent = await new Promise((res) =>
        chrome.storage.sync.get('accent', (v) => res(v.accent))
      );
      const mark = document.getElementById('previewMark');
      const light = mark ? mark.style.getPropertyValue('--preview-light') : '';
      return JSON.stringify({
        swatches: swatches.length,
        accent: accent,
        light: light
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
    pass = data.swatches === 6 && data.accent === 'blue' && data.light.indexOf('80, 170, 255') !== -1;
  } catch (err) {
    pass = false;
  }

  console.log(pass ? 'PASS options-palette' : 'FAIL options-palette');

  ws.close();
  killTree(child.pid);
  process.exit(pass ? 0 : 1);
})();
