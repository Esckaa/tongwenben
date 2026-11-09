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

  /** 元素/文本的父级；走到 shadow root 顶部时跳到 host。 */
  function parentOrHost(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;

    const root = node.getRootNode ? node.getRootNode() : null;
    return root && root.host ? root.host : null;
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
      const scrollable = /(auto|scroll|overlay|hidden)/.test(cs.overflowY);
      if (scrollable && node.scrollHeight > node.clientHeight + 1) {
        list.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
      }
      node = parentOrHost(node);
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
          /(auto|scroll|overlay|hidden)/.test(pcs.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 1
        ) {
          list.push({ el: parent, top: parent.scrollTop, left: parent.scrollLeft });
        }
        parent = parentOrHost(parent);
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

  /** 判断目标为什么不可见：折叠、隐藏、或被移除。 */
  function diagnoseTarget(range) {
    const el = elementOf(range.startContainer);
    if (!el) return { kind: 'gone', el: null };

    // 先看折叠：内容即使有 content-visibility，也优先报“折叠”
    let node = el;
    while (node) {
      if (node.tagName === 'DETAILS' && !node.open) {
        let summary = null;
        try {
          summary = node.querySelector(':scope > summary');
        } catch (err) {
          summary = null;
        }
        if (!summary || !summary.contains(el)) {
          return { kind: 'details', el: node };
        }
      }
      node = parentOrHost(node);
    }

    node = el;
    while (node) {
      const win = node.ownerDocument && node.ownerDocument.defaultView;
      if (win) {
        const cs = win.getComputedStyle(node);
        if (
          cs &&
          (cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            cs.visibility === 'collapse' ||
            cs.contentVisibility === 'hidden')
        ) {
          return { kind: 'hidden', el: node };
        }
      }
      node = parentOrHost(node);
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return { kind: 'invisible', el };
    }

    return null;
  }

  /** 取 range 的视口矩形；不可见时返回 null。 */
  function rectOf(range) {
    try {
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return rect;
    } catch (err) {
      return null;
    }
  }

  function isScrollBox(el, win) {
    let cs;
    try {
      cs = win.getComputedStyle(el);
    } catch (err) {
      return false;
    }
    // hidden 也纳入：不少阅读器用 overflow:hidden + 程序化 scrollTop 做自定义滚动条
    if (!/(auto|scroll|overlay|hidden)/.test(cs.overflowY)) return false;
    return el.scrollHeight > el.clientHeight + 1;
  }

  /** 由内向外，把 range 所在的每个滚动容器对准命中位置，而不是居中所属的大元素。 */
  function scrollBoxesToRange(range, doc) {
    const win = doc.defaultView;
    if (!win) return false;

    const start = elementOf(range.startContainer);
    if (!start) return false;

    const boxes = [];
    let node = start;
    while (node && node !== doc.body && node !== doc.documentElement) {
      if (isScrollBox(node, win)) boxes.push(node);
      node = parentOrHost(node);
    }

    for (const box of boxes) {
      const rect = rectOf(range);
      if (!rect) return false;

      const boxRect = box.getBoundingClientRect();
      const innerTop = boxRect.top + (box.clientTop || 0);
      const innerHeight = box.clientHeight;

      // 已经完整落在容器可视区里，就不动它
      if (rect.top >= innerTop + 8 && rect.bottom <= innerTop + innerHeight - 8) {
        continue;
      }

      const delta = rect.top - (innerTop + (innerHeight - rect.height) / 2);
      if (Math.abs(delta) > 2) box.scrollTop += delta;
    }

    return true;
  }

  /** 在 range 所在文档里对准它：先滚容器，再滚窗口。 */
  function centerRangeInDoc(range, doc, smooth) {
    const win = doc.defaultView;
    if (!win) return false;
    if (!scrollBoxesToRange(range, doc)) return false;

    // 命中在 position:fixed 的面板里时，滚窗口不会移动它，反而会把整页带跑
    let node = elementOf(range.startContainer);
    while (node) {
      let cs;
      try {
        cs = win.getComputedStyle(node);
      } catch (err) {
        break;
      }
      if (cs.position === 'fixed') return true;
      node = parentOrHost(node);
    }

    const rect = rectOf(range);
    if (!rect) return false;

    const margin = 40;
    if (rect.top >= margin && rect.bottom <= win.innerHeight - margin) return true;

    const dy = rect.top - (win.innerHeight * 0.45 - rect.height / 2);
    if (Math.abs(dy) > 4) {
      win.scrollBy({ top: dy, left: 0, behavior: smooth ? 'smooth' : 'auto' });
    }

    return true;
  }

  function jumpTo(range) {
    const doc = range.startContainer.ownerDocument;
    const el = elementOf(range.startContainer);
    if (!el) return { ok: false, note: '目标已从页面移除' };

    const issue = diagnoseTarget(range);

    // 折叠内容：点击跳转视为用户意图，直接展开
    if (issue && issue.kind === 'details') {
      try {
        issue.el.open = true;
      } catch (err) {
        // 忽略
      }
    }

    if (!centerRangeInDoc(range, doc, doc === document)) {
      if (issue && issue.kind === 'hidden') {
        return { ok: false, note: '目标被隐藏（display:none 或 visibility:hidden）' };
      }
      if (issue && issue.kind === 'details') {
        return { ok: false, note: '目标在折叠内容里，展开后仍不可见' };
      }
      return { ok: false, note: '目标当前不可见（可能被折叠或隐藏）' };
    }

    // 把外层 iframe 逐级带进视口，只在命中点真的出界时才动
    let d = doc;
    while (d !== document) {
      const win = d.defaultView;
      const frame = win && win.frameElement;
      if (!frame) break;

      const rect = rectOf(range);
      if (rect) {
        const point = toTopPoint(d, rect.left, rect.top);
        if (point.y < 30 || point.y > window.innerHeight - 30) {
          try {
            frame.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          } catch (err) {
            frame.scrollIntoView();
          }
        }
      }

      d = frame.ownerDocument;
    }

    // iframe 内的坐标不能直接拿来滚顶层；先换算到顶层，再只在外框里微调
    if (doc !== document) {
      const rect = rectOf(range);
      if (rect) {
        const point = toTopPoint(doc, rect.left, rect.top);
        if (point.y < 30 || point.y > window.innerHeight - 30) {
          const dy = point.y - (window.innerHeight * 0.45 - rect.height / 2);
          if (Math.abs(dy) > 6) {
            window.scrollBy({ top: dy, left: 0, behavior: 'smooth' });
          }
        }
      }
    }

    return {
      ok: true,
      note: issue && issue.kind === 'details' ? '已展开折叠内容并跳转' : ''
    };
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
        const result = jumpTo(item.range);
        if (!result.ok) popup.setNote(result.note || '目标当前不可见');
        else if (result.note) popup.setNote(result.note);
      }
    });
  }

  /** 真实鼠标在 shadow 里选中时，document 的 Selection 只是镜像；从事件路径找 shadow root。 */
  function shadowRootOf(e) {
    const path = e.composedPath ? e.composedPath() : [];
    const target = path[0] || e.target;
    if (!target || !target.getRootNode) return null;

    const root = target.getRootNode();
    return root && root.nodeType === 11 && root.host ? root : null;
  }

  function run(doc, shadowRoot) {
    doc = doc || document;
    const win = doc.defaultView;
    if (!win) return;

    let sel = null;
    if (shadowRoot && typeof shadowRoot.getSelection === 'function') {
      try {
        sel = shadowRoot.getSelection();
      } catch (err) {
        sel = null;
      }
    }

    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
      sel = win.getSelection();
    }

    if (shadowRoot && sel && sel.anchorNode) {
      const anchorRoot = sel.anchorNode.getRootNode ? sel.anchorNode.getRootNode() : null;
      if (anchorRoot !== shadowRoot) sel = win.getSelection();
    }

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

  function schedule(ms, doc, shadowRoot) {
    const targetDoc = doc || document;
    const key = shadowRoot || targetDoc;
    const prev = timers.get(key);
    if (prev) clearTimeout(prev);

    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        run(targetDoc, shadowRoot);
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
    schedule(MOUSE_DEBOUNCE, doc, shadowRootOf(e));
  }

  function onMouseDown(e, doc) {
    if (!popup.isOpen()) return;
    if (doc === document && isOurEvent(e)) return;
    closeAll();
  }

  function onSelectionChange(doc, shadowRoot) {
    if (popup.isOpen() && jumped) return;
    schedule(KEY_DEBOUNCE, doc, shadowRoot);
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

  /** shadow root 的变化不会冒泡到 document，要单独观察。 */
  function observeShadowRoot(root) {
    if (!root || observedDocs.has(root)) return;
    observedDocs.add(root);

    const mo = new MutationObserver(onMutations);
    mo.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // 影子树里的选区变化不一定在 document 上触发，单独监听
    root.addEventListener('selectionchange', () => {
      onSelectionChange(root.ownerDocument || document, root);
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
    for (const root of textMap.shadowRoots || []) observeShadowRoot(root);
  }

  /* ---------- 启动 ---------- */

  watchDoc(document);

  window.addEventListener('resize', () => {
    if (popup.isOpen()) closeAll();
  });

  // 自测钩子：内容脚本运行在隔离世界，页面脚本看不到；
  // 只有把 content.js 当普通脚本加载的 test/e2e.html 能用到。
  window.__STS_DEBUG__ = { popup, highlighter, getMap, diagnoseTarget, jumpTo };
})();
