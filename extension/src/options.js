/* 设置页：读写 chrome.storage.sync，内容脚本监听变化后即时生效。 */
(function () {
  'use strict';

  const DEFAULTS = {
    fallback: true,
    groupByHeading: true,
    maxShow: 100,
    accent: 'amber'
  };

  const fallbackEl = document.getElementById('fallback');
  const groupEl = document.getElementById('groupByHeading');
  const maxShowEl = document.getElementById('maxShow');
  const statusEl = document.getElementById('status');
  const paletteEl = document.getElementById('palette');
  const previewMark = document.getElementById('previewMark');

  let accent = DEFAULTS.accent;
  let statusTimer = 0;

  function flash(text) {
    statusEl.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 1600);
  }

  function renderPalette() {
    const theme = window.STS && STS.Theme;
    if (!theme || !paletteEl) return;

    paletteEl.textContent = '';
    for (const key of Object.keys(theme.PRESETS)) {
      const preset = theme.PRESETS[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.dataset.accent = key;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', preset.name);

      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background =
        'linear-gradient(135deg,' + preset.light + ' 0 48%,' + preset.strong + ' 52% 100%)';

      const name = document.createElement('span');
      name.className = 'swatch-name';
      name.textContent = preset.name;

      btn.append(chip, name);
      btn.addEventListener('click', () => selectAccent(key));
      paletteEl.appendChild(btn);
    }
  }

  function updatePreview() {
    const theme = window.STS && STS.Theme;
    if (!theme || !previewMark) return;

    const preset = theme.get(accent);
    for (const btn of paletteEl.querySelectorAll('.swatch')) {
      const on = btn.dataset.accent === accent;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }

    previewMark.style.setProperty('--preview-light', preset.light);
    previewMark.style.setProperty('--preview-strong', preset.strong);
  }

  function selectAccent(key) {
    const theme = window.STS && STS.Theme;
    accent = theme && theme.PRESETS[key] ? key : 'amber';
    updatePreview();
    save();
  }

  function fill(value) {
    const v = Object.assign({}, DEFAULTS, value || {});
    fallbackEl.checked = v.fallback !== false;
    groupEl.checked = v.groupByHeading !== false;
    maxShowEl.value = String(v.maxShow || 100);
    accent = v.accent || 'amber';
    updatePreview();
  }

  function save() {
    chrome.storage.sync.set(
      {
        fallback: fallbackEl.checked,
        groupByHeading: groupEl.checked,
        maxShow: Number(maxShowEl.value) || 100,
        accent: accent
      },
      () => flash('已保存')
    );
  }

  renderPalette();
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
