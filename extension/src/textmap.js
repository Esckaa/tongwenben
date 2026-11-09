/* 同文本检索 · 文本层
 *
 * 把 DOM 里的文本拼成一条“虚拟字符串”，同时记录
 *   全局偏移 -> (文本节点, 节点内偏移)
 * 的映射。这样 `人工<b>智能</b>` 这种被标签切断的文本也能被搜到。
 *
 * 同源 iframe 会被递归并入同一条字符串；跨域 iframe 静默跳过。
 * 块级元素之间插入哨兵 \u0001，防止把两个段落拼成一句假匹配。
 * 隐藏子树（display:none / visibility:hidden / content-visibility:hidden）整棵跳过。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});

  const SEP = '\u0001';

  // 这些标签的内容不参与检索
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS',
    'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'HEAD',
    'META', 'LINK', 'TITLE',
    // 表单控件里的文本不是页面可见正文，且可能是默认值而非当前值
    'SELECT', 'OPTION', 'OPTGROUP', 'DATALIST', 'TEXTAREA'
  ]);

  // 这些标签视为块级边界
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD',
    'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LEGEND', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
    'THEAD', 'TR', 'UL', 'BR'
  ]);

  let styleCache = new WeakMap();

  function isHidden(el) {
    if (styleCache.has(el)) return styleCache.get(el);

    let hidden = false;
    if (el.hasAttribute('hidden')) {
      hidden = true;
    } else {
      const win = el.ownerDocument && el.ownerDocument.defaultView;
      const cs = win ? win.getComputedStyle(el) : null;
      if (cs) {
        hidden =
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          cs.visibility === 'collapse' ||
          cs.contentVisibility === 'hidden';
      }
    }

    styleCache.set(el, hidden);
    return hidden;
  }

  /** 同源 iframe 才拿得到 contentDocument；跨域返回 null。 */
  function frameDocOf(el) {
    try {
      const doc = el.contentDocument;
      return doc && doc.documentElement ? doc : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * 建立文本索引。
   * @param {Element} [root] 索引根节点，默认 document.body
   * @param {{includeFrames?:boolean}} [options] includeFrames=false 时不进 iframe
   */
  function build(root, options) {
    root = root || document.body;
    const includeFrames = !options || options.includeFrames !== false;
    styleCache = new WeakMap();

    const chunks = [];
    const segs = [];
    const headings = [];
    const docs = new Set([root.ownerDocument || document]);
    const shadowRoots = new Set();
    const visitedDocs = new Set([root.ownerDocument || document]);
    const visitedRoots = new Set();
    let length = 0;
    let lastWasSep = true; // 避免开头出现分隔符

    const pushSep = () => {
      if (!lastWasSep) {
        chunks.push(SEP);
        length += 1;
        lastWasSep = true;
      }
    };

    const pushText = (node) => {
      const value = node.nodeValue;
      if (!value) return;
      chunks.push(value);
      segs.push({ node, start: length, end: length + value.length });
      length += value.length;
      lastWasSep = false;
    };

    // 迭代式 DFS，避免深 DOM 递归爆栈
    const stack = [{ node: root, exit: false }];
    while (stack.length) {
      const entry = stack.pop();

      if (entry.sepAfterFrame) {
        pushSep();
        continue;
      }

      const node = entry.node;

      if (entry.exit) {
        if (typeof entry.heading === 'number' && entry.heading >= 0) {
          headings[entry.heading].end = length;
        }
        if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) pushSep();
        continue;
      }

      if (node.nodeType === 3) {
        pushText(node);
        continue;
      }
      if (node.nodeType !== 1) continue;

      if (node.hasAttribute && node.hasAttribute('data-sts-host')) continue;
      if (isHidden(node)) continue;

      // 同源 iframe：把子文档当成一段内容接进来
      if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
        pushSep();
        if (includeFrames) {
          const doc = frameDocOf(node);
          if (doc && !visitedDocs.has(doc)) {
            visitedDocs.add(doc);
            docs.add(doc);
            const body = doc.body || doc.documentElement;
            if (body) {
              // 先压“结束后补分隔符”，再压子文档根，保证子文档内容在两者之间
              stack.push({ node: null, exit: true, sepAfterFrame: true });
              stack.push({ node: body, exit: false });
            }
          }
        }
        continue;
      }

      // 开放 shadow root：渲染内容在影子树里，light DOM 只有通过 slot 才会显示
      if (node.shadowRoot) {
        const shadow = node.shadowRoot;
        if (!visitedRoots.has(shadow)) {
          visitedRoots.add(shadow);
          shadowRoots.add(shadow);
          pushSep();
          stack.push({ node: null, exit: true, sepAfterFrame: true });
          const shadowKids = shadow.childNodes;
          for (let i = shadowKids.length - 1; i >= 0; i -= 1) {
            stack.push({ node: shadowKids[i], exit: false });
          }
        }
        continue;
      }

      // slot：走 assignedNodes，没有分配时退回 fallback 内容
      if (node.tagName === 'SLOT') {
        pushSep();
        let assigned = [];
        try {
          assigned = node.assignedNodes ? node.assignedNodes({ flatten: true }) : [];
        } catch (err) {
          assigned = [];
        }
        const list = assigned.length ? assigned : Array.from(node.childNodes);
        stack.push({ node: null, exit: true, sepAfterFrame: true });
        for (let i = list.length - 1; i >= 0; i -= 1) {
          stack.push({ node: list[i], exit: false });
        }
        continue;
      }

      if (SKIP_TAGS.has(node.tagName)) continue;

      if (BLOCK_TAGS.has(node.tagName)) pushSep();
      if (node.tagName === 'BR') {
        pushSep();
        continue;
      }

      const isHeading = /^H[1-6]$/.test(node.tagName);
      if (isHeading) {
        headings.push({
          level: Number(node.tagName.charAt(1)),
          start: length,
          end: length
        });
      }

      stack.push({
        node,
        exit: true,
        heading: isHeading ? headings.length - 1 : -1
      });
      const kids = node.childNodes;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        stack.push({ node: kids[i], exit: false });
      }
    }

    return { text: chunks.join(''), segs, headings, docs, shadowRoots, sep: SEP };
  }

  /**
   * 全局偏移 -> 节点内偏移。
   * 偏移落在分隔符或空隙上时返回 null。
   */
  function locate(segs, pos) {
    let lo = 0;
    let hi = segs.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const seg = segs[mid];
      if (pos < seg.start) {
        hi = mid - 1;
      } else if (pos >= seg.end) {
        lo = mid + 1;
      } else {
        return { node: seg.node, offset: pos - seg.start };
      }
    }

    return null;
  }

  /** 用全局偏移构造一个 Range；Range 必须建在节点所属的 document 上。 */
  function rangeFor(map, start, end) {
    if (end <= start) return null;

    const a = locate(map.segs, start);
    const b = locate(map.segs, end - 1);
    if (!a || !b) return null;

    const range = a.node.ownerDocument.createRange();
    try {
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset + 1);
    } catch (err) {
      return null;
    }
    return range;
  }

  /** 取原文片段，分隔符显示为空格，便于做列表摘要。 */
  function sliceRaw(map, from, to) {
    const text = map.text;
    const start = Math.max(0, Math.min(from, text.length));
    const end = Math.max(start, Math.min(to, text.length));
    return text.slice(start, end).split(SEP).join(' ');
  }

  STS.TextMap = { build, locate, rangeFor, sliceRaw, SEP, BLOCK_TAGS, SKIP_TAGS };
})(window);
