/* PDF 阅读器：用 PDF.js 渲染页面和可选中的文字层，检索逻辑直接复用扩展本身。
 * 既能在扩展页里跑，也能在本地 HTTP 下跑（自测用）。
 */
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;

pdfjsLib.GlobalWorkerOptions.workerSrc = isExtension
  ? chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs')
  : new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const pagesEl = document.getElementById('pages');
const emptyEl = document.getElementById('empty');
const metaEl = document.getElementById('meta');
const progressEl = document.getElementById('progress');
const zoomLabel = document.getElementById('zoomLabel');
const fileInput = document.getElementById('file');
const testOut = document.getElementById('test-out');

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const MAX_PAGES = 60;

let pdfDoc = null;
let token = 0;
let zoom = 1;
let baseScale = 1.3;
let fileName = '';
let testDone = false;

function setProgress(text) {
  progressEl.textContent = text || '';
  progressEl.classList.toggle('is-on', !!text);
}

function out(text) {
  if (!TEST) return;
  testOut.hidden = false;
  testOut.textContent = text;
}

async function renderAll(myToken) {
  if (!pdfDoc) return;

  pagesEl.textContent = '';
  const total = Math.min(pdfDoc.numPages, MAX_PAGES);

  for (let i = 1; i <= total; i += 1) {
    if (myToken !== token) return;

    setProgress('正在渲染 ' + i + '/' + total + ' 页');
    const page = await pdfDoc.getPage(i);
    if (myToken !== token) return;

    const viewport = page.getViewport({ scale: baseScale * zoom });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.dataset.page = String(i);
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    }).promise;
    if (myToken !== token) return;

    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    textDiv.style.setProperty('--scale-factor', String(viewport.scale));

    wrap.append(canvas, textDiv);
    pagesEl.appendChild(wrap);

    const layer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport
    });
    await layer.render();
  }

  if (myToken !== token) return;

  setProgress('');
  metaEl.textContent =
    fileName +
    ' · ' +
    pdfDoc.numPages +
    ' 页' +
    (pdfDoc.numPages > MAX_PAGES ? '（仅加载前 ' + MAX_PAGES + ' 页）' : '');
  zoomLabel.textContent = Math.round(zoom * 100) + '%';

  window.__PDF_VIEWER__ = { doc: pdfDoc, rendered: total, ready: true };

  if (TEST && !testDone) {
    testDone = true;
    setTimeout(runTest, 300);
  }
}

async function loadPdf(buffer, name) {
  const my = ++token;
  pdfDoc = null;
  testDone = false;
  pagesEl.textContent = '';
  emptyEl.style.display = 'none';
  window.__PDF_VIEWER__ = { ready: false };
  setProgress('正在解析 PDF…');

  try {
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true
    });
    const doc = await task.promise;
    if (my !== token) return;

    pdfDoc = doc;
    fileName = name || 'PDF';

    const first = await doc.getPage(1);
    const firstViewport = first.getViewport({ scale: 1 });
    const available = Math.max(320, window.innerWidth - 72);
    baseScale = Math.min(2, Math.max(0.5, available / firstViewport.width));
    zoom = 1;

    await renderAll(my);
  } catch (err) {
    if (my !== token) return;
    setProgress('');
    emptyEl.style.display = '';
    const cardTitle = document.querySelector('.empty-card h1');
    const cardText = document.querySelector('.empty-card p');
    if (cardTitle) cardTitle.textContent = '打不开这个 PDF';
    if (cardText) cardText.textContent = (err && err.message) || String(err);
  }
}

function setZoom(next) {
  if (!pdfDoc) return;
  zoom = Math.max(0.4, Math.min(3, next));
  const my = ++token;
  renderAll(my);
}

function runTest() {
  const needle = params.get('token') || 'PDFTEST';
  const walker = document.createTreeWalker(pagesEl, NodeFilter.SHOW_TEXT);
  let node = null;
  let index = -1;

  while ((node = walker.nextNode())) {
    index = node.nodeValue.indexOf(needle);
    if (index >= 0) break;
  }

  if (!node || index < 0) {
    out('TOKEN_NOT_FOUND');
    return;
  }

  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + needle.length);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  document.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, clientX: 420, clientY: 320, button: 0 })
  );

  setTimeout(() => {
    const all = window.CSS && CSS.highlights ? CSS.highlights.get('sts-all') : null;
    out(
      'HOST ' + (document.querySelector('[data-sts-host]') ? 'YES' : 'NO') +
      '\nALL ' + (all ? Array.from(all).length : -1) +
      '\nPAGES ' + (window.__PDF_VIEWER__ ? window.__PDF_VIEWER__.rendered : -1)
    );
  }, 900);
}

/* ---------- 交互 ---------- */

fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  await loadPdf(buffer, file.name);
  fileInput.value = '';
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setProgress('只支持 PDF 文件');
    setTimeout(() => setProgress(''), 1600);
    return;
  }
  const buffer = await file.arrayBuffer();
  await loadPdf(buffer, file.name);
});

document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom * 1.15));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom / 1.15));
document.getElementById('fit').addEventListener('click', () => setZoom(1));

/* ---------- 自测入口 ---------- */

const autoPdf = params.get('pdf');
if (autoPdf) {
  setProgress('正在读取 PDF…');
  fetch(autoPdf)
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then((buffer) => loadPdf(buffer, autoPdf.split('/').pop()))
    .catch((err) => {
      setProgress('');
      setProgress('加载失败：' + err.message);
    });
}
