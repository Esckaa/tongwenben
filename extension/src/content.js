/* 同文本检索 · 内容脚本
 *
 * 串起：选区监听 -> 文本索引 -> 归一化查找 -> 全页高亮 -> 浮层 -> 跳转。
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
  let timer = 0;
  let lastPointer = null;
  let lastKey = '';
  let lastAt = 0;
  let originScroll = null;
  let jumped = false;

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

  /* ---------- 索引 ---------- */

  function getMap() {
    if (!map || mapDirty) {
      const built = TextMap.build(document.body);
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

  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

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
    const list = [{ el: null, top: window.scrollY, left: window.scrollX }];
    let node = startEl;

    while (node && node !== document.body && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const scrollable = /(auto|scroll|overlay)/.test(cs.overflowY);
      if (scrollable && node.scrollHeight > node.clientHeight + 1) {
        list.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
      }
      node = node.parentElement;
    }

    return list;
  }

  function restoreScroll(list) {
    if (!list) return;
    for (const item of list) {
      if (item.el) {
        item.el.scrollTop = item.top;
        item.el.scrollLeft = item.left;
      } else {
        window.scrollTo(item.left, item.top);
      }
    }
  }

  /* ---------- 跳转 ---------- */

  function jumpTo(range) {
    const el = elementOf(range.startContainer);
    if (!el) return false;

    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (err) {
      el.scrollIntoView();
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;

    // 长段落里 scrollIntoView 居中的是段落，再按命中位置微调
    const targetTop = window.innerHeight * 0.45 - rect.height / 2;
    const dy = rect.top - targetTop;
    if (Math.abs(dy) > 8) {
      window.scrollBy({ top: dy, left: 0, behavior: 'smooth' });
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

  function run() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const raw = sel.toString();
    if (!raw || !raw.trim()) return;

    if (isEditable(sel.anchorNode) || isEditable(sel.focusNode)) return;
    if (visibleCharCount(raw) < minLength(raw)) return;

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

    const m = getMap();
    const maxShow = Math.min(500, Math.max(10, Number(settings.maxShow) || 100));
    const hits = Search.findExact(m, needle, MAX_SCAN);

    // 只命中选区自己，对「题干找原文」没有意义；先记下，看兜底能不能给出别的
    let selfOnly = false;
    if (hits.length === 1) {
      const only = Search.toRawRange(m, hits[0]);
      const onlyRange = TextMap.rangeFor(m, only.start, only.end);
      selfOnly = !!(onlyRange && isSelfHit(range, onlyRange));
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
        .filter((item) => !(item.range && isSelfHit(range, item.range)))
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

    if (!items.length) {
      highlighter.clear();
      originScroll = null;
      jumped = false;
      popup.showEmpty({
        needle: raw.trim(),
        x: pointer ? pointer.x : window.innerWidth / 2,
        y: pointer ? pointer.y : window.innerHeight / 2
      });
      return;
    }

    const anchorEl = elementOf(sel.anchorNode);
    originScroll = captureScroll(anchorEl);
    jumped = false;

    highlighter.setAll(items.slice(0, MAX_HIGHLIGHT).map((item) => item.range));

    const x = pointer ? pointer.x : range.getBoundingClientRect().right;
    const y = pointer ? pointer.y : range.getBoundingClientRect().bottom;

    popup.openPanel({
      mode,
      needle: raw.trim(),
      total: capped ? MAX_SCAN + '+' : String(total),
      capped,
      grouped: settings.groupByHeading,
      items,
      x,
      y,
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

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  function isOurEvent(e) {
    if (!popup.host) return false;
    const path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(popup.host) !== -1;
  }

  /* ---------- 事件 ---------- */

  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0) return;
      if (isOurEvent(e)) return;
      lastPointer = { x: e.clientX, y: e.clientY };
      schedule(MOUSE_DEBOUNCE);
    },
    true
  );

  document.addEventListener('selectionchange', () => {
    if (popup.isOpen() && jumped) return;
    schedule(KEY_DEBOUNCE);
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!popup.isOpen()) return;
      if (isOurEvent(e)) return;
      closeAll();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
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
    },
    true
  );

  window.addEventListener('resize', () => {
    if (popup.isOpen()) closeAll();
  });

  /* ---------- DOM 变化标记索引失效 ---------- */

  const observer = new MutationObserver((mutations) => {
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
      return;
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // 自测钩子：内容脚本运行在隔离世界，页面脚本看不到；
  // 只有把 content.js 当普通脚本加载的 test/e2e.html 能用到。
  window.__STS_DEBUG__ = { popup, highlighter, getMap };
})();
