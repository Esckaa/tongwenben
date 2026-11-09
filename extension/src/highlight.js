/* 同文本检索 · 高亮
 *
 * 使用 CSS Custom Highlight API：只登记 Range，不往页面里插任何节点。
 * 好处是不破坏 React/Vue 的节点树、不打断用户选区、不触发站点重渲染。
 * 代价是 ::highlight 只支持颜色/背景/下划线/文字阴影，画不了边框。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});

  class Highlighter {
    constructor() {
      this.allName = 'sts-all';
      this.activeName = 'sts-active';
      this.supported =
        !!global.CSS &&
        !!global.CSS.highlights &&
        typeof global.Highlight === 'function';
    }

    setAll(ranges) {
      if (!this.supported) return;
      try {
        if (!ranges || !ranges.length) {
          global.CSS.highlights.delete(this.allName);
          return;
        }
        global.CSS.highlights.set(this.allName, new global.Highlight(...ranges));
      } catch (err) {
        // 单个 Range 失效不应影响其他命中
        console.warn('[STS] setAll failed', err);
      }
    }

    setActive(range) {
      if (!this.supported) return;
      try {
        if (!range) {
          global.CSS.highlights.delete(this.activeName);
          return;
        }
        global.CSS.highlights.set(this.activeName, new global.Highlight(range));
      } catch (err) {
        console.warn('[STS] setActive failed', err);
      }
    }

    clear() {
      if (!this.supported) return;
      global.CSS.highlights.delete(this.allName);
      global.CSS.highlights.delete(this.activeName);
    }
  }

  STS.Highlighter = Highlighter;
})(window);
