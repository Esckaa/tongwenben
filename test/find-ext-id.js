/* 探测未打包扩展的 ID：按 Chrome 的路径哈希规则生成候选，再逐个打开验证。 */
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const PORT = 9336;
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'ext-id-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idOf(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex')
    .slice(0, 32)
    .split('')
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
}

function candidates() {
  const variants = [
    ['utf8', EXT],
    ['utf8-lower', EXT.toLowerCase()],
    ['utf8-slash', EXT.replace(/\\/g, '/')],
    ['utf8-slash-lower', EXT.replace(/\\/g, '/').toLowerCase()],
    ['utf16le', EXT],
    ['utf16le-lower', EXT.toLowerCase()],
    ['utf8-trailing', EXT + '\\'],
    ['utf16le-trailing', EXT + '\\']
  ];

  const seen = new Set();
  const out = [];
  for (const [name, value] of variants) {
    const buf = name.indexOf('utf16') === 0 ? Buffer.from(value, 'utf16le') : Buffer.from(value, 'utf8');
    const id = idOf(buf);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, id });
  }
  return out;
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
  for (let i = 0; i < 80; i += 1) {
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
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    return;
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

  await cmd('Page.enable');
  await cmd('Runtime.enable');

  for (const c of candidates()) {
    await cmd('Page.navigate', { url: 'chrome-extension://' + c.id + '/pdf-viewer.html' });
    await sleep(1300);

    const res = await cmd('Runtime.evaluate', {
      expression: `JSON.stringify({
        href: location.href,
        title: document.title,
        hasPages: !!document.getElementById('pages'),
        body: (document.body ? document.body.innerText.slice(0, 60) : '')
      })`,
      returnByValue: true
    });

    const value = res.result && res.result.result ? res.result.result.value : '';
    console.log(c.name + ' ' + c.id + ' ' + value);

    if (value && value.indexOf('"hasPages":true') !== -1) {
      console.log('MATCH ' + c.id);
      break;
    }
  }

  ws.close();
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
})();
