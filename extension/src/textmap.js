/* 同文本检索 · 文本层
 *
 * 把 DOM 里的文本拼成一条“虚拟字符串”，同时记录
 *   全局偏移 -> (文本节点, 节点内偏移)
 * 的映射。这样 `人工<b>智能</b>` 这种被标签切断的文本也能被搜到。
 *
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
    'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'HEAD',
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
      const cs = global.getComputedStyle(el);
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

  /**
   * 建立文本索引。
   * @param {Element} [root] 索引根节点，默认 document.body
   * @returns {{text:string, segs:Array<{node:Text,start:number,end:number}>, sep:string}}
   */
  function build(root) {
    root = root || document.body;
    styleCache = new WeakMap();

    const chunks = [];
    const segs = [];
    const headings = [];
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
      const frame = stack.pop();
      const node = frame.node;

      if (frame.exit) {
        if (typeof frame.heading === 'number' && frame.heading >= 0) {
          headings[frame.heading].end = length;
        }
        if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) pushSep();
        continue;
      }

      if (node.nodeType === 3) {
        pushText(node);
        continue;
      }
      if (node.nodeType !== 1) continue;

      if (SKIP_TAGS.has(node.tagName)) continue;
      if (node.hasAttribute && node.hasAttribute('data-sts-host')) continue;
      if (isHidden(node)) continue;

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

    return { text: chunks.join(''), segs, headings, sep: SEP };
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

  /** 用全局偏移构造一个 Range；跨文本节点时 Range 会自然跨过去。 */
  function rangeFor(map, start, end) {
    if (end <= start) return null;

    const a = locate(map.segs, start);
    const b = locate(map.segs, end - 1);
    if (!a || !b) return null;

    const range = document.createRange();
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
