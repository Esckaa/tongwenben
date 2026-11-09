/* 打印加载扩展后 CDP 暴露的所有 target，用于找扩展 ID。 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const EDGE =
  process.env.STS_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT = path.resolve(__dirname, '..', 'extension');
const PORT = 9335;
const PROFILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.dsh',
  'tmp',
  'ext-targets-' + Date.now()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      'edge://extensions'
    ],
    { stdio: 'ignore', detached: true }
  );
  child.unref();

  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json');
      const list = await res.json();
      if (list.length) {
        for (const t of list) console.log(t.type + '  ' + t.url);
        break;
      }
    } catch (err) {
      // 等
    }
    await sleep(300);
  }

  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (err) {
    // 已退出
  }
})();
