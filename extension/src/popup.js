/* 同文本检索 · 浮层
 *
 * 关闭的 Shadow DOM 承载面板，彻底隔离站点样式。
 * 面板固定定位；标题栏可拖拽，拖到哪就停在哪，不挡视线时不用管它。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});

  const MIN_CSS = [
    '.panel{width:360px;max-width:calc(100vw - 16px);background:#fff;color:#1a1a1a;',
    'border:1px solid rgba(0,0,0,.14);border-radius:10px;',
    'box-shadow:0 8px 28px rgba(0,0,0,.2);',
    'font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    'overflow:hidden;user-select:none}',
    '.head{display:flex;gap:8px;align-items:baseline;padding:8px 12px;',
    'border-bottom:1px solid rgba(0,0,0,.08);cursor:move;touch-action:none}',
    '.grip{flex:0 0 auto;color:#bbb;font-size:11px;letter-spacing:-1px}',
    '.title{font-weight:600;white-space:nowrap}',
    '.needle{flex:1;min-width:0;text-align:right;color:#777;font-size:12px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.list{max-height:min(52vh,380px);overflow-y:auto;overscroll-behavior:contain;padding:4px}',
    '.group{padding:6px 8px 2px;color:#999;font-size:11px}',
    '.item{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;',
    'background:none;border:0;padding:6px 8px;border-radius:6px;cursor:pointer;',
    'font:inherit;color:inherit}',
    '.item:hover,.item.is-active{background:rgba(255,193,7,.2)}',
    '.idx{flex:0 0 auto;min-width:18px;color:#999;font-size:11px;padding-top:2px}',
    '.snip{flex:1;min-width:0;word-break:break-word}',
    '.snip mark{background:rgba(255,213,0,.75);color:inherit;border-radius:2px;padding:0 1px}',
    '.score{flex:0 0 auto;color:#b26a00;font-size:11px;padding-top:2px}',
    '.empty{padding:16px 12px;color:#666}',
    '.empty p{margin:0 0 6px}',
    '.empty small{color:#999}',
    '.foot{display:flex;justify-content:space-between;gap:8px;padding:6px 12px;',
    'border-top:1px solid rgba(0,0,0,.08);color:#999;font-size:11px}'
  ].join('');

  let cssPromise = null;

  function loadCss() {
    if (cssPromise) return cssPromise;

    cssPromise = (async () => {
      try {
        if (!global.chrome || !chrome.runtime || !chrome.runtime.getURL) return '';
        const url = chrome.runtime.getURL('src/popup.css');
        const res = await fetch(url);
        if (!res.ok) return '';
        return await res.text();
      } catch (err) {
        return '';
      }
    })();

    return cssPromise;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  class Popup {
    constructor() {
      this.host = null;
      this.root = null;
      this.panel = null;
      this.titleEl = null;
      this.needleEl = null;
      this.listEl = null;
      this.noteEl = null;
      this.items = [];
      this.activeIndex = -1;
      this.open = false;
      this.mode = 'exact';
      this.onPick = null;
      this.onHover = null;
      this.drag = null;
    }

    isOpen() {
      return this.open;
    }

    ensure() {
      if (this.host) return;

      const host = document.createElement('div');
      host.setAttribute('data-sts-host', '');
      host.style.cssText =
        'all:initial;position:fixed;left:0;top:0;z-index:2147483647;display:block;';

      const root = host.attachShadow({ mode: 'closed' });

      // 先放一份最小样式，CSS 文件还没到/被 CSP 拦时也能用
      const fallback = document.createElement('style');
      fallback.textContent = MIN_CSS;
      root.appendChild(fallback);

      loadCss().then((css) => {
        if (!css) return;
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          root.adoptedStyleSheets = [sheet];
        } catch (err) {
          // 构造样式表不可用时保留最小样式
        }
      });

      const panel = el('div', 'panel');
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', '相同文本');

      const head = el('div', 'head');
      head.appendChild(el('span', 'grip', '⠿'));
      this.titleEl = el('span', 'title');
      this.needleEl = el('span', 'needle');
      head.append(this.titleEl, this.needleEl);

      const onDragStart = (e) => {
        if (e.button !== 0) return;
        const left = parseFloat(this.host.style.left) || 0;
        const top = parseFloat(this.host.style.top) || 0;
        this.drag = { dx: e.clientX - left, dy: e.clientY - top };
        try {
          head.setPointerCapture(e.pointerId);
        } catch (err) {
          // 不支持指针捕获时退化为普通移动
        }
        e.preventDefault();
      };

      const onDragMove = (e) => {
        if (!this.drag) return;
        const w = this.panel.offsetWidth;
        const h = this.panel.offsetHeight;
        const left = clamp(e.clientX - this.drag.dx, 8, Math.max(8, global.innerWidth - w - 8));
        const top = clamp(e.clientY - this.drag.dy, 8, Math.max(8, global.innerHeight - h - 8));
        this.host.style.left = Math.round(left) + 'px';
        this.host.style.top = Math.round(top) + 'px';
      };

      const onDragEnd = (e) => {
        this.drag = null;
        try {
          head.releasePointerCapture(e.pointerId);
        } catch (err) {
          // 指针已释放
        }
      };

      head.addEventListener('pointerdown', onDragStart);
      head.addEventListener('pointermove', onDragMove);
      head.addEventListener('pointerup', onDragEnd);
      head.addEventListener('pointercancel', onDragEnd);

      this.listEl = el('div', 'list');

      const foot = el('div', 'foot');
      this.keysEl = el('span', 'keys', '↑↓ 选择 · Enter 跳转 · Esc 关闭');
      this.noteEl = el('span', 'note');
      foot.append(this.keysEl, this.noteEl);

      panel.append(head, this.listEl, foot);

      // 只对条目阻止默认，保住页面选区；列表保留滚动条拖拽
      panel.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('.item')) e.preventDefault();
      });

      root.appendChild(panel);
      document.documentElement.appendChild(host);

      this.host = host;
      this.root = root;
      this.panel = panel;
    }

    position(x, y) {
      this.host.style.left = '0px';
      this.host.style.top = '0px';

      const rect = this.panel.getBoundingClientRect();
      const gap = 14;
      const margin = 8;

      let left = x + gap;
      let top = y + gap;

      if (left + rect.width > global.innerWidth - margin) {
        left = x - rect.width - gap;
      }
      if (top + rect.height > global.innerHeight - margin) {
        top = y - rect.height - gap;
      }

      left = clamp(left, margin, Math.max(margin, global.innerWidth - rect.width - margin));
      top = clamp(top, margin, Math.max(margin, global.innerHeight - rect.height - margin));

      this.host.style.left = Math.round(left) + 'px';
      this.host.style.top = Math.round(top) + 'px';
    }

    openPanel(options) {
      this.ensure();

      this.items = options.items || [];
      this.activeIndex = -1;
      this.open = true;
      this.mode = options.mode || 'exact';
      this.onPick = options.onPick || null;
      this.onHover = options.onHover || null;

      const total = options.total;
      this.titleEl.textContent =
        this.mode === 'fallback'
          ? '没有其他完全一致 · 最相近的 ' + total + ' 段'
          : '找到 ' + total + ' 处';
      this.needleEl.textContent = options.needle || '';
      this.needleEl.title = options.needle || '';

      this.keysEl.textContent = '↑↓ 选择 · Enter 跳转 · Esc 关闭';
      this.noteEl.textContent = options.capped
        ? '仅显示前 ' + this.items.length + ' 条'
        : this.mode === 'fallback'
          ? '按关键词覆盖排序'
          : '';

      this.listEl.textContent = '';
      const frag = document.createDocumentFragment();
      let lastGroup = null;

      this.items.forEach((item, i) => {
        if (options.grouped && item.group && item.group !== lastGroup) {
          frag.appendChild(el('div', 'group', item.group));
          lastGroup = item.group;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'item';
        btn.dataset.i = String(i);
        btn.setAttribute('role', 'option');

        const idx = el('span', 'idx', String(i + 1));
        const snip = el('span', 'snip');
        snip.append(
          document.createTextNode(item.before),
          el('mark', '', item.hit),
          document.createTextNode(item.after)
        );

        btn.append(idx, snip);

        if (this.mode === 'fallback' && typeof item.score === 'number') {
          btn.appendChild(el('span', 'score', item.score + '%'));
        }

        btn.addEventListener('mouseenter', () => this.setActive(i, false));
        btn.addEventListener('click', () => {
          this.setActive(i, false);
          if (this.onPick) this.onPick(i);
          this.setNote('Esc 先回原位，再按一次关闭');
        });

        frag.appendChild(btn);
      });

      this.listEl.appendChild(frag);
      this.position(options.x, options.y);
    }

    showEmpty(options) {
      this.ensure();

      this.items = [];
      this.activeIndex = -1;
      this.open = true;
      this.mode = 'exact';
      this.onPick = null;
      this.onHover = null;

      this.titleEl.textContent = '没找到完全一致的文本';
      this.needleEl.textContent = '';
      this.keysEl.textContent = 'Esc 关闭';
      this.noteEl.textContent = '';

      this.listEl.textContent = '';
      const box = el('div', 'empty');
      const p1 = el('p', '', '可以只选其中 3–6 个词再试。');
      const p2 = el('small', '', '只检索当前页面已渲染的可见文本。');
      box.append(p1, p2);
      this.listEl.appendChild(box);

      this.position(options.x, options.y);
    }

    setNote(text) {
      if (this.noteEl) this.noteEl.textContent = text || '';
    }

    setActive(index, scrollIntoList) {
      if (index === this.activeIndex) return;

      const prev = this.panel.querySelector('.item.is-active');
      if (prev) prev.classList.remove('is-active');

      this.activeIndex = index;

      const btn = this.panel.querySelector('.item[data-i="' + index + '"]');
      if (btn) {
        btn.classList.add('is-active');
        if (scrollIntoList) {
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }

      if (this.onHover) this.onHover(index);
    }

    move(delta) {
      if (!this.items.length) return;

      let next = this.activeIndex;
      if (next < 0) {
        next = delta > 0 ? 0 : this.items.length - 1;
      } else {
        next = clamp(next + delta, 0, this.items.length - 1);
      }

      this.setActive(next, true);
    }

    activate() {
      if (this.activeIndex >= 0 && this.onPick) {
        this.onPick(this.activeIndex);
        this.setNote('Esc 先回原位，再按一次关闭');
      }
    }

    close() {
      if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
      this.host = null;
      this.root = null;
      this.panel = null;
      this.items = [];
      this.activeIndex = -1;
      this.open = false;
      this.mode = 'exact';
      this.onPick = null;
      this.onHover = null;
      this.drag = null;
    }
  }

  STS.Popup = Popup;
})(window);
