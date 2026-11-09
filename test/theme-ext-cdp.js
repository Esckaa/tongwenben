/* 真实扩展链路：设置页选蓝色 → 打开内容页 → 选中文字 → 页面高亮应为蓝色，且 3 处都在。 */
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const PAGE = 'http://127.0.0.1:8765/test/fixtures/theme-plain.html';
const PORT = Number(process.env.STS_CDP_PORT || 9344);
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'theme-ext-' + Date.now()
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

  async function evalJs(expression) {
    const res = await cmd('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    const result = res.result || {};
    if (result.exceptionDetails) return { __error: result.exceptionDetails.text };
    return result.result ? result.result.value : undefined;
  }

  await cmd('Runtime.enable');
  await cmd('Page.enable');

  await cmd('Page.navigate', {
    url: 'chrome-extension://' + idOf(EXT) + '/options.html'
  });
  await sleep(1200);
  await evalJs(`(() => {
    const blue = document.querySelector('[data-accent="blue"]');
    if (blue) blue.click();
    return !!blue;
  })()`);
  await sleep(400);

  await cmd('Page.navigate', { url: PAGE });
  await sleep(1600);

  const info = await evalJs(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const node = document.getElementById('t').firstChild;
    const needle = 'THEMETEST';
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, needle.length);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, clientX: 200, clientY: 80, button: 0
    }));

    await sleep(900);

    const all = CSS.highlights.get('sts-all');
    const css = Array.from(document.adoptedStyleSheets || [])
      .map((s) => {
        try {
          return Array.from(s.cssRules).map((r) => r.cssText).join('');
        } catch (e) {
          return '';
        }
      })
      .join('');

    return JSON.stringify({
      all: all ? Array.from(all).length : -1,
      blue: css.indexOf('80, 170, 255') !== -1
    });
  })()`);

  console.log('INFO ' + info);

  let pass = false;
  try {
    const data = JSON.parse(info);
    pass = data.all === 3 && data.blue === true;
  } catch (err) {
    pass = false;
  }

  console.log(pass ? 'PASS extension-theme' : 'FAIL extension-theme');

  ws.close();
  killTree(child.pid);
  process.exit(pass ? 0 : 1);
})();
