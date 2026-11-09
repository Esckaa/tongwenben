/* 同文本检索 · 高亮
 *
 * 使用 CSS Custom Highlight API：只登记 Range，不往页面里插节点。
 * Range 可能属于顶层、同源 iframe、或开放 shadow root：
 *   - 注册表按 document 分组（CSS.highlights 是 document 级的）；
 *   - ::highlight 样式要注入到 Range 所在的根（document / iframe document / shadow root），
 *     否则不会染色；换色时直接 replaceSync 已注入的样式表。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});

  const DEFAULT_THEME = {
    light: 'rgba(255, 214, 0, 0.38)',
    lightDark: 'rgba(255, 196, 0, 0.30)',
    strong: 'rgba(255, 122, 0, 0.78)',
    strongDark: 'rgba(255, 140, 0, 0.72)'
  };

  class Highlighter {
    constructor() {
      this.allName = 'sts-all';
      this.activeName = 'sts-active';
      this.docs = new Set();
      this.activeDoc = null;
      this.styledRoots = new Set();
      this.theme =
        (STS.Theme && STS.Theme.get('amber')) || DEFAULT_THEME;
    }

    supportedIn(doc) {
      const win = doc && doc.defaultView;
      return !!(win && win.CSS && win.CSS.highlights && typeof win.Highlight === 'function');
    }

    get supported() {
      return this.supportedIn(document);
    }

    cssText() {
      if (STS.Theme) return STS.Theme.css(this.theme);
      const t = this.theme;
      return (
        '::highlight(sts-all){background-color:' + t.light + ' !important;}' +
        '::highlight(sts-active){background-color:' + t.strong + ' !important;}' +
        '@media (prefers-color-scheme:dark){' +
        '::highlight(sts-all){background-color:' + t.lightDark + ' !important;}' +
        '::highlight(sts-active){background-color:' + t.strongDark + ' !important;}' +
        '}'
      );
    }

    /** root 可以是 Document 或 ShadowRoot；顶层也要注入，才能跟随色系。 */
    ensureStyle(root) {
      if (!root) return;

      const doc = root.ownerDocument || root;
      const win = doc && doc.defaultView;
      const css = this.cssText();

      if (root.__stsSheet) {
        if (root.__stsCss !== css) {
          try {
            root.__stsSheet.replaceSync(css);
            root.__stsCss = css;
          } catch (err) {
            // 样式表已失效，下面重建
            root.__stsSheet = null;
          }
        }
        this.styledRoots.add(root);
        return;
      }

      if (root.__stsStyle) {
        if (root.__stsCss !== css) {
          root.__stsStyle.textContent = css;
          root.__stsCss = css;
        }
        this.styledRoots.add(root);
        return;
      }

      try {
        if (!win || typeof win.CSSStyleSheet !== 'function') throw new Error('no CSSStyleSheet');
        const sheet = new win.CSSStyleSheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = Array.from(root.adoptedStyleSheets || []).concat(sheet);
        root.__stsSheet = sheet;
        root.__stsCss = css;
        this.styledRoots.add(root);
      } catch (err) {
        try {
          const style = doc.createElement('style');
          style.textContent = css;
          if (root.nodeType === 9) {
            (root.head || root.documentElement).appendChild(style);
          } else {
            root.appendChild(style);
          }
          root.__stsStyle = style;
          root.__stsCss = css;
          this.styledRoots.add(root);
        } catch (err2) {
          // 站点 CSP 拦住时只能保留 page.css 的默认色
        }
      }
    }

    /** 切换色系：更新所有已经注入过样式的根。 */
    setTheme(theme) {
      const next =
        typeof theme === 'string' && STS.Theme ? STS.Theme.get(theme) : theme;
      if (!next) return;

      this.theme = next;
      const css = this.cssText();

      for (const root of this.styledRoots) {
        if (root.__stsSheet) {
          try {
            root.__stsSheet.replaceSync(css);
            root.__stsCss = css;
          } catch (err) {
            // 忽略单个根
          }
        } else if (root.__stsStyle) {
          root.__stsStyle.textContent = css;
          root.__stsCss = css;
        }
      }
    }

    clearDoc(doc) {
      const win = doc && doc.defaultView;
      if (!win || !win.CSS || !win.CSS.highlights) return;
      win.CSS.highlights.delete(this.allName);
      win.CSS.highlights.delete(this.activeName);
    }

    /** 只清当前高亮，保留 sts-all 的浅色底。 */
    clearActiveDoc(doc) {
      const win = doc && doc.defaultView;
      if (!win || !win.CSS || !win.CSS.highlights) return;
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
        this.clearActiveDoc(this.activeDoc);
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
