/* 同文本检索 · 高亮
 *
 * 使用 CSS Custom Highlight API：只登记 Range，不往页面里插节点。
 * Range 可能属于顶层、同源 iframe、或开放 shadow root：
 *   - 注册表按 document 分组（CSS.highlights 是 document 级的）；
 *   - ::highlight 样式要注入到 Range 所在的根（iframe document / shadow root），
 *     否则影子树里的文字不会被染色。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});

  const STYLE =
    '::highlight(sts-all){background-color:rgba(255,214,0,.42);}' +
    '::highlight(sts-active){background-color:rgba(255,120,0,.78);}' +
    '@media (prefers-color-scheme:dark){' +
    '::highlight(sts-all){background-color:rgba(255,196,0,.32);}' +
    '::highlight(sts-active){background-color:rgba(255,132,0,.7);}' +
    '}';

  class Highlighter {
    constructor() {
      this.allName = 'sts-all';
      this.activeName = 'sts-active';
      this.docs = new Set();
      this.activeDoc = null;
    }

    supportedIn(doc) {
      const win = doc && doc.defaultView;
      return !!(win && win.CSS && win.CSS.highlights && typeof win.Highlight === 'function');
    }

    get supported() {
      return this.supportedIn(document);
    }

    /** root 可以是 Document 或 ShadowRoot。 */
    ensureStyle(root) {
      if (!root || root === document) return; // 顶层由扩展的 page.css 负责
      if (root.__stsHighlightStyle) return;

      const doc = root.ownerDocument || root;
      const win = doc && doc.defaultView;

      try {
        if (!win || typeof win.CSSStyleSheet !== 'function') return;
        const sheet = new win.CSSStyleSheet();
        sheet.replaceSync(STYLE);
        root.adoptedStyleSheets = Array.from(root.adoptedStyleSheets || []).concat(sheet);
        root.__stsHighlightStyle = true;
      } catch (err) {
        try {
          const style = doc.createElement('style');
          style.textContent = STYLE;
          if (root.nodeType === 9) {
            (root.head || root.documentElement).appendChild(style);
          } else {
            root.appendChild(style);
          }
          root.__stsHighlightStyle = true;
        } catch (err2) {
          // 站点 CSP 拦住时只能放弃这一层的视觉高亮
        }
      }
    }

    clearDoc(doc) {
      const win = doc && doc.defaultView;
      if (!win || !win.CSS || !win.CSS.highlights) return;
      win.CSS.highlights.delete(this.allName);
      win.CSS.highlights.delete(this.activeName);
    }

    clear() {
      for (const doc of this.docs) this.clearDoc(doc);
      this.docs.clear();
      this.activeDoc = null;
    }

    setAll(ranges) {
      this.clear();
      if (!ranges || !ranges.length) return;

      const byDoc = new Map();
      for (const range of ranges) {
        const doc = range.startContainer.ownerDocument;
        if (!this.supportedIn(doc)) continue;

        const root = range.startContainer.getRootNode
          ? range.startContainer.getRootNode()
          : doc;
        this.ensureStyle(root);

        if (!byDoc.has(doc)) byDoc.set(doc, []);
        byDoc.get(doc).push(range);
      }

      for (const [doc, list] of byDoc) {
        try {
          const win = doc.defaultView;
          win.CSS.highlights.set(this.allName, new win.Highlight(...list));
          this.docs.add(doc);
        } catch (err) {
          console.warn('[STS] setAll failed', err);
        }
      }
    }

    setActive(range) {
      if (this.activeDoc) {
        this.clearDoc(this.activeDoc);
        this.activeDoc = null;
      }
      if (!range) return;

      const doc = range.startContainer.ownerDocument;
      if (!this.supportedIn(doc)) return;

      try {
        const root = range.startContainer.getRootNode
          ? range.startContainer.getRootNode()
          : doc;
        this.ensureStyle(root);

        const win = doc.defaultView;
        win.CSS.highlights.set(this.activeName, new win.Highlight(range));
        this.activeDoc = doc;
        this.docs.add(doc);
      } catch (err) {
        console.warn('[STS] setActive failed', err);
      }
    }
  }

  STS.Highlighter = Highlighter;
})(window);
