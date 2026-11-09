/* 同文本检索 · 内容脚本
 *
 * 串起：选区监听 -> 文本索引 -> 归一化查找 -> 全页高亮 -> 浮层 -> 跳转。
 * 同源 iframe 会被并入同一份索引：事件按 document 监听，高亮按 document 注册。
 * 零结果时按设置走近似兜底。
 */
(function () {
  'use strict';

  const STS = window.STS;
  if (!STS || !STS.TextMap || !STS.Search || !STS.Highlighter || !STS.Popup) {
    console.warn('[STS] 模块未加载，扩展未生效');
    return;
  }

  const { TextMap, Search } = STS;

  const VERSION = (() => {
    try {
      return window.chrome && chrome.runtime && chrome.runtime.getManifest
        ? chrome.runtime.getManifest().version
        : '';
    } catch (err) {
      return '';
    }
  })();

  const MAX_SCAN = 5000; // 最多扫描多少个命中
  const MAX_HIGHLIGHT = 600; // 最多高亮多少处
  const MOUSE_DEBOUNCE = 140;
  const KEY_DEBOUNCE = 320;

  const DEFAULTS = { fallback: true, groupByHeading: true, maxShow: 100 };

  const highlighter = new STS.Highlighter();
  const popup = new STS.Popup();

  let settings = Object.assign({}, DEFAULTS);
  let map = null;
  let mapDirty = true;
  const timers = new Map();
  let lastPointer = null;
  let lastKey = '';
  let lastAt = 0;
  let originScroll = null;
  let jumped = false;
  let currentSearch = null;
  let lastSig = '';
  let refreshTimer = 0;

  const watchedDocs = new WeakSet();
  const observedDocs = new WeakSet();

  if (!highlighter.supported) {
    console.warn('[STS] 当前浏览器不支持 CSS Custom Highlight API，高亮将不可用');
  }

  function loadSettings() {
    if (!window.chrome || !chrome.storage || !chrome.storage.sync) return;

    try {
      chrome.storage.sync.get(DEFAULTS, (value) => {
        settings = Object.assign({}, DEFAULTS, value || {});
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        for (const key of Object.keys(changes)) {
          settings[key] = changes[key].newValue;
        }
      });
    } catch (err) {
      // 扩展环境外（自测页）忽略
    }
  }

  loadSettings();

  /* ---------- 跨 document 工具 ---------- */

  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  /** iframe 内的坐标 -> 顶层视口坐标 */
  function toTopPoint(doc, x, y) {
    let win = doc && doc.defaultView;
    let px = x;
    let py = y;

    while (win && win !== window) {
      const frame = win.frameElement;
      if (!frame) break;
      const rect = frame.getBoundingClientRect();
      px += rect.left + (frame.clientLeft || 0);
      py += rect.top + (frame.clientTop || 0);
      win = frame.ownerDocument.defaultView;
    }

    return { x: px, y: py };
  }

  /* ---------- 索引 ---------- */

  function getMap() {
    if (!map || mapDirty) {
      const root = document.querySelector('[data-sts-root]') || document.body;
      const built = TextMap.build(root);
      built.norm = Search.normalizeWithMap(built.text);
      built.headings = (built.headings || [])
        .map((h) => ({
          level: h.level,
          start: h.start,
          end: h.end,
          text: TextMap.sliceRaw(built, h.start, h.end).replace(/\s+/g, ' ').trim().slice(0, 40)
        }))
        .filter((h) => h.text);

      map = built;
      mapDirty = false;
      watchMapDocs(map);
    }
    return map;
  }

  function groupOf(textMap, rawStart) {
    if (!settings.groupByHeading) return '';
    let label = '';
    for (const heading of textMap.headings) {
      if (heading.start <= rawStart) label = heading.text;
      else break;
    }
    return label;
  }

  /* ---------- 选区校验 ---------- */

  function isEditable(node) {
    const el = elementOf(node);
    if (!el) return false;
    if (el.closest && el.closest('input, textarea, select')) return true;
    return !!el.isContentEditable;
  }

  function visibleCharCount(text) {
    return text.replace(/\s/g, '').length;
  }

  function minLength(text) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 2 : 3;
  }

  /** 命中区间是否整个落在当前选区内（也就是“命中了选区自己”）。 */
  function isSelfHit(selRange, hitRange) {
    try {
      return (
        selRange.compareBoundaryPoints(Range.START_TO_START, hitRange) <= 0 &&
        selRange.compareBoundaryPoints(Range.END_TO_END, hitRange) >= 0
      );
    } catch (err) {
      return false;
    }
  }

  /* ---------- 滚动位置 ---------- */

  function captureScroll(startEl) {
    const list = [];
    let doc = startEl ? startEl.ownerDocument : document;
    let node = startEl;

    while (node && node !== doc.body && node !== doc.documentElement) {
      const win = doc.defaultView;
      const cs = win.getComputedStyle(node);
      const scrollable = /(auto|scroll|overlay)/.test(cs.overflowY);
      if (scrollable && node.scrollHeight > node.clientHeight + 1) {
        list.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
      }
      node = node.parentElement;
    }

    let win = doc.defaultView;
    while (win) {
      list.push({ win, top: win.scrollY, left: win.scrollX });
      if (win === window) break;

      const frame = win.frameElement;
      if (!frame) break;

      const parentDoc = frame.ownerDocument;
      let parent = frame.parentElement;
      while (parent && parent !== parentDoc.body) {
        const pcs = parentDoc.defaultView.getComputedStyle(parent);
        if (
          /(auto|scroll|overlay)/.test(pcs.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 1
        ) {
          list.push({ el: parent, top: parent.scrollTop, left: parent.scrollLeft });
        }
        parent = parent.parentElement;
      }

      win = parentDoc.defaultView;
    }

    return list;
  }

  function restoreScroll(list) {
    if (!list) return;
    for (const item of list) {
      if (item.el) {
        item.el.scrollTop = item.top;
        item.el.scrollLeft = item.left;
      } else if (item.win) {
        item.win.scrollTo(item.left, item.top);
      }
    }
  }

  /* ---------- 跳转 ---------- */

  function jumpTo(range) {
    const doc = range.startContainer.ownerDocument;
    const el = elementOf(range.startContainer);
    if (!el) return false;

    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (err) {
      el.scrollIntoView();
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;

    // 把外层 iframe 逐级滚进视口
    let win = doc.defaultView;
    while (win && win !== window) {
      const frame = win.frameElement;
      if (!frame) break;
      try {
        frame.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (err) {
        frame.scrollIntoView();
      }
      win = frame.ownerDocument.defaultView;
    }

    // 顶层文档才做像素级微调；iframe 内的坐标不能直接拿来滚顶层
    if (doc === document) {
      const targetTop = window.innerHeight * 0.45 - rect.height / 2;
      const dy = rect.top - targetTop;
      if (Math.abs(dy) > 8) {
        window.scrollBy({ top: dy, left: 0, behavior: 'smooth' });
      }
    }

    return true;
  }

  /* ---------- 面板 ---------- */

  function closeAll() {
    popup.close();
    highlighter.clear();
    originScroll = null;
    jumped = false;
    lastKey = '';
    currentSearch = null;
    lastSig = '';
    clearTimeout(refreshTimer);

    for (const pending of timers.values()) clearTimeout(pending);
    timers.clear();
  }

  function onEscape() {
    if (jumped && originScroll) {
      restoreScroll(originScroll);
      highlighter.setActive(null);
      jumped = false;
      popup.setNote('');
      return;
    }
    closeAll();
  }

  /** 页面变化后，若面板还开着，防抖重算一次并原地更新。 */
  function scheduleRefresh() {
    if (!popup.isOpen() || !currentSearch) return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!popup.isOpen() || !currentSearch) return;
      const snapshot = currentSearch;
      executeSearch(snapshot.raw, snapshot.pointer, snapshot.selRange, true);
    }, 450);
  }

  /* ---------- 摘要 ---------- */

  function snippetOf(textMap, rawStart, rawEnd) {
    const before = TextMap.sliceRaw(textMap, Math.max(0, rawStart - 60), rawStart)
      .replace(/\s+/g, ' ')
      .replace(/^\s+/, '');
    const after = TextMap.sliceRaw(
      textMap,
      rawEnd,
      Math.min(textMap.text.length, rawEnd + 60)
    )
      .replace(/\s+/g, ' ')
      .replace(/\s+$/, '');

    return {
      before: (rawStart > 60 ? '…' : '') + before,
      hit: TextMap.sliceRaw(textMap, rawStart, rawEnd).replace(/\s+/g, ' '),
      after: after + (rawEnd + 60 < textMap.text.length ? '…' : '')
    };
  }

  /* ---------- 主流程 ---------- */

  function buildExactItems(textMap, hits, maxShow) {
    const items = [];

    for (let i = 0; i < hits.length && items.length < maxShow; i += 1) {
      const hit = hits[i];
      const rawRange = Search.toRawRange(textMap, hit);
      const r = TextMap.rangeFor(textMap, rawRange.start, rawRange.end);
      if (!r) continue;

      items.push({
        ...snippetOf(textMap, rawRange.start, rawRange.end),
        range: r,
        group: groupOf(textMap, rawRange.start)
      });
    }

    return items;
  }

  function executeSearch(raw, pointer, selRange, keepPosition) {
    const needle = Search.normalizeNeedle(raw);
    if (!needle) return;

    currentSearch = { raw, pointer, selRange };

    const m = getMap();
    const maxShow = Math.min(500, Math.max(10, Number(settings.maxShow) || 100));
    const hits = Search.findExact(m, needle, MAX_SCAN);

    // 只命中选区自己，对「题干找原文」没有意义；先记下，看兜底能不能给出别的
    let selfOnly = false;
    if (hits.length === 1 && selRange) {
      const only = Search.toRawRange(m, hits[0]);
      const onlyRange = TextMap.rangeFor(m, only.start, only.end);
      selfOnly = !!(onlyRange && isSelfHit(selRange, onlyRange));
    }

    let mode = 'exact';
    let items = [];
    let total = hits.length;
    let capped = false;

    if (hits.length && !selfOnly) {
      capped = hits.length >= MAX_SCAN;
      items = buildExactItems(m, hits, maxShow);
    } else if (settings.fallback !== false && STS.Fallback) {
      // 多取几个，先剔掉选区自己那句，再截到 3 条；否则题干会白占一个名额
      const fb = STS.Fallback.find(m, raw, 8);
      const fbItems = fb.items
        .filter((item) => !(item.range && selRange && isSelfHit(selRange, item.range)))
        .slice(0, 3);

      if (fbItems.length) {
        mode = 'fallback';
        total = fbItems.length;
        items = fbItems.map((item) => ({
          ...item,
          group: groupOf(m, item.rawStart)
        }));
      } else if (selfOnly) {
        // 兜底也给不出别的，就把选区自己这一处还回来
        items = buildExactItems(m, hits, maxShow);
      }
    } else if (selfOnly) {
      items = buildExactItems(m, hits, maxShow);
    }

    let x = pointer ? pointer.x : window.innerWidth / 2;
    let y = pointer ? pointer.y : window.innerHeight / 2;
    if (!pointer && selRange) {
      const rect = selRange.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) {
        const point = toTopPoint(selRange.startContainer.ownerDocument, rect.right, rect.bottom);
        x = point.x;
        y = point.y;
      }
    }

    if (!items.length) {
      highlighter.clear();
      highlighter.setActive(null);
      if (!keepPosition) {
        originScroll = null;
        jumped = false;
      }
      lastSig = 'empty';
      popup.showEmpty({ needle: raw.trim(), x, y, keepPosition });
      return;
    }

    const sig =
      mode +
      '|' +
      total +
      '|' +
      (capped ? 'c' : '') +
      '|' +
      items.map((item) => item.hit).join('\u0001');

    // 页面变化触发的重绘：结果没变就不动面板，避免闪烁
    if (keepPosition && sig === lastSig) return;
    lastSig = sig;

    if (!keepPosition) {
      originScroll = captureScroll(selRange ? elementOf(selRange.startContainer) : null);
      jumped = false;
    }

    highlighter.setActive(null);
    highlighter.setAll(items.slice(0, MAX_HIGHLIGHT).map((item) => item.range));

    popup.openPanel({
      mode,
      needle: raw.trim(),
      total: capped ? MAX_SCAN + '+' : String(total),
      capped,
      grouped: settings.groupByHeading,
      items,
      x,
      y,
      keepPosition,
      onHover: (index) => {
        if (index >= 0 && items[index]) highlighter.setActive(items[index].range);
        else highlighter.setActive(null);
      },
      onPick: (index) => {
        const item = items[index];
        if (!item) return;
        highlighter.setActive(item.range);
        jumped = true;
        const ok = jumpTo(item.range);
        if (!ok) popup.setNote('目标当前不可见（可能被折叠或隐藏）');
      }
    });
  }

  function run(doc) {
    doc = doc || document;
    const win = doc.defaultView;
    if (!win) return;

    const sel = win.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const raw = sel.toString();
    if (!raw || !raw.trim()) return;

    if (isEditable(sel.anchorNode) || isEditable(sel.focusNode)) return;
    if (visibleCharCount(raw) < minLength(raw)) return;

    // 页面用 data-sts-root 圈定了检索范围时，范围外的选区不处理
    const scope = doc.querySelector('[data-sts-root]');
    if (scope && !scope.contains(sel.anchorNode)) return;
    if (scope && !scope.contains(sel.focusNode)) return;

    const needle = Search.normalizeNeedle(raw);
    if (!needle) return;

    const pointer = lastPointer;
    const key =
      needle +
      '|' +
      (pointer ? Math.round(pointer.x / 4) + ',' + Math.round(pointer.y / 4) : 'k');
    if (key === lastKey && Date.now() - lastAt < 700 && popup.isOpen()) return;
    lastKey = key;
    lastAt = Date.now();

    executeSearch(raw, pointer, range, false);
  }

  function schedule(ms, doc) {
    const target = doc || document;
    const prev = timers.get(target);
    if (prev) clearTimeout(prev);

    timers.set(
      target,
      setTimeout(() => {
        timers.delete(target);
        run(target);
      }, ms)
    );
  }

  function isOurEvent(e) {
    if (!popup.host) return false;
    const path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(popup.host) !== -1;
  }

  /* ---------- 事件 ---------- */

  function onMouseUp(e, doc) {
    if (e.button !== 0) return;
    if (doc === document && isOurEvent(e)) return;
    lastPointer = toTopPoint(doc, e.clientX, e.clientY);
    schedule(MOUSE_DEBOUNCE, doc);
  }

  function onMouseDown(e, doc) {
    if (!popup.isOpen()) return;
    if (doc === document && isOurEvent(e)) return;
    closeAll();
  }

  function onSelectionChange(doc) {
    if (popup.isOpen() && jumped) return;
    schedule(KEY_DEBOUNCE, doc);
  }

  function onKeyDown(e, doc) {
    if (!popup.isOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }

    if (isEditable(e.target)) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      popup.move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      popup.move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      popup.activate();
    }
  }

  /* ---------- 观察各 document ---------- */

  function onMutations(mutations) {
    for (const mu of mutations) {
      if (mu.type === 'childList') {
        let onlyOurs = true;
        for (const n of mu.addedNodes) {
          if (n !== popup.host) {
            onlyOurs = false;
            break;
          }
        }
        if (onlyOurs) {
          for (const n of mu.removedNodes) {
            if (n !== popup.host) {
              onlyOurs = false;
              break;
            }
          }
        }
        if (onlyOurs) continue;
      } else if (popup.host && mu.target === popup.host) {
        continue;
      }

      mapDirty = true;
      scheduleRefresh();
      return;
    }
  }

  function observeDoc(doc) {
    if (!doc || !doc.documentElement || observedDocs.has(doc)) return;
    observedDocs.add(doc);

    const mo = new MutationObserver(onMutations);
    mo.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /** iframe 加载/切换文档后，索引和监听都要跟着更新 */
  function attachFrameLoads(doc) {
    const frames = doc.querySelectorAll('iframe, frame');
    for (const frame of frames) {
      if (frame.__stsLoadHooked) continue;
      frame.__stsLoadHooked = true;
      frame.addEventListener('load', () => {
        mapDirty = true;
        try {
          const child = frame.contentDocument;
          if (child) watchDoc(child);
        } catch (err) {
          // 跨域或已卸载
        }
        scheduleRefresh();
      });
    }
  }

  /** 已经加载完成的同源 iframe，直接接管它的 document。 */
  function watchExistingFrames(doc) {
    for (const frame of doc.querySelectorAll('iframe, frame')) {
      try {
        const child = frame.contentDocument;
        if (child && child.body) watchDoc(child);
      } catch (err) {
        // 跨域
      }
    }
  }

  function watchDoc(doc) {
    if (!doc || !doc.documentElement || watchedDocs.has(doc)) return;
    watchedDocs.add(doc);

    try {
      doc.documentElement.setAttribute('data-sts-version', VERSION || 'unknown');
    } catch (err) {
      // 只用于诊断，失败无所谓
    }

    doc.addEventListener('mouseup', (e) => onMouseUp(e, doc), true);
    doc.addEventListener('mousedown', (e) => onMouseDown(e, doc), true);
    doc.addEventListener('selectionchange', () => onSelectionChange(doc));
    doc.addEventListener('keydown', (e) => onKeyDown(e, doc), true);

    observeDoc(doc);
    attachFrameLoads(doc);
    watchExistingFrames(doc);
  }

  function watchMapDocs(textMap) {
    if (!textMap || !textMap.docs) return;
    for (const doc of textMap.docs) watchDoc(doc);
  }

  /* ---------- 启动 ---------- */

  watchDoc(document);

  window.addEventListener('resize', () => {
    if (popup.isOpen()) closeAll();
  });

  // 自测钩子：内容脚本运行在隔离世界，页面脚本看不到；
  // 只有把 content.js 当普通脚本加载的 test/e2e.html 能用到。
  window.__STS_DEBUG__ = { popup, highlighter, getMap };
})();
