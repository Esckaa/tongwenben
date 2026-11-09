/* 同文本检索 · 高亮
 *
 * 使用 CSS Custom Highlight API：只登记 Range，不往页面里插任何节点。
 * 同源 iframe 的 Range 归属各自的 document，所以按 document 分组注册，
 * 并给 iframe 文档补一份 ::highlight 样式（顶层由 page.css 注入）。
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

    ensureStyle(doc) {
      if (doc === document) return; // 顶层由扩展的 page.css 负责
      if (doc.__stsHighlightStyle) return;

      try {
        const win = doc.defaultView;
        if (!win || typeof win.CSSStyleSheet !== 'function') return;
        const sheet = new win.CSSStyleSheet();
        sheet.replaceSync(STYLE);
        doc.adoptedStyleSheets = Array.from(doc.adoptedStyleSheets || []).concat(sheet);
        doc.__stsHighlightStyle = true;
      } catch (err) {
        try {
          const style = doc.createElement('style');
          style.textContent = STYLE;
          (doc.head || doc.documentElement).appendChild(style);
          doc.__stsHighlightStyle = true;
        } catch (err2) {
          // 站点 CSP 拦住时只能放弃 iframe 内的视觉高亮
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
        if (!byDoc.has(doc)) byDoc.set(doc, []);
        byDoc.get(doc).push(range);
      }

      for (const [doc, list] of byDoc) {
        try {
          this.ensureStyle(doc);
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
        this.ensureStyle(doc);
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
