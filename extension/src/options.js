/* 设置页：读写 chrome.storage.sync，内容脚本监听变化后即时生效。 */
(function () {
  'use strict';

  const DEFAULTS = { fallback: true, groupByHeading: true, maxShow: 100 };

  const fallbackEl = document.getElementById('fallback');
  const groupEl = document.getElementById('groupByHeading');
  const maxShowEl = document.getElementById('maxShow');
  const statusEl = document.getElementById('status');

  let statusTimer = 0;

  function flash(text) {
    statusEl.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 1600);
  }

  function fill(value) {
    const v = Object.assign({}, DEFAULTS, value || {});
    fallbackEl.checked = v.fallback !== false;
    groupEl.checked = v.groupByHeading !== false;
    maxShowEl.value = String(v.maxShow || 100);
  }

  function save() {
    chrome.storage.sync.set(
      {
        fallback: fallbackEl.checked,
        groupByHeading: groupEl.checked,
        maxShow: Number(maxShowEl.value) || 100
      },
      () => flash('已保存')
    );
  }

  chrome.storage.sync.get(DEFAULTS, fill);

  fallbackEl.addEventListener('change', save);
  groupEl.addEventListener('change', save);
  maxShowEl.addEventListener('change', save);

  const openPdf = document.getElementById('openPdf');
  if (openPdf) {
    openPdf.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('pdf-viewer.html') });
    });
  }
})();
