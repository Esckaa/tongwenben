/* 同文本检索 · 高亮色系
 *
 * 每个色系固定两档：light 用于全部命中，strong 用于悬停/选中。
 * 深色模式单独给一组，避免在深色背景上过亮。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});

  const PRESETS = {
    amber: {
      name: '琥珀',
      light: 'rgba(255, 214, 0, 0.38)',
      strong: 'rgba(255, 122, 0, 0.78)',
      lightDark: 'rgba(255, 196, 0, 0.30)',
      strongDark: 'rgba(255, 140, 0, 0.72)',
      mark: 'rgba(255, 213, 0, 0.68)',
      markDark: 'rgba(255, 213, 0, 0.42)'
    },
    green: {
      name: '绿色',
      light: 'rgba(76, 217, 100, 0.32)',
      strong: 'rgba(0, 150, 80, 0.78)',
      lightDark: 'rgba(76, 217, 100, 0.24)',
      strongDark: 'rgba(0, 190, 110, 0.70)',
      mark: 'rgba(76, 217, 100, 0.55)',
      markDark: 'rgba(76, 217, 100, 0.38)'
    },
    blue: {
      name: '蓝色',
      light: 'rgba(80, 170, 255, 0.30)',
      strong: 'rgba(20, 105, 220, 0.78)',
      lightDark: 'rgba(80, 170, 255, 0.24)',
      strongDark: 'rgba(40, 140, 255, 0.72)',
      mark: 'rgba(80, 170, 255, 0.50)',
      markDark: 'rgba(80, 170, 255, 0.38)'
    },
    purple: {
      name: '紫色',
      light: 'rgba(178, 130, 255, 0.30)',
      strong: 'rgba(118, 60, 220, 0.78)',
      lightDark: 'rgba(178, 130, 255, 0.24)',
      strongDark: 'rgba(150, 95, 255, 0.72)',
      mark: 'rgba(178, 130, 255, 0.50)',
      markDark: 'rgba(178, 130, 255, 0.38)'
    },
    pink: {
      name: '粉色',
      light: 'rgba(255, 130, 190, 0.30)',
      strong: 'rgba(210, 40, 120, 0.78)',
      lightDark: 'rgba(255, 130, 190, 0.24)',
      strongDark: 'rgba(240, 70, 150, 0.70)',
      mark: 'rgba(255, 130, 190, 0.50)',
      markDark: 'rgba(255, 130, 190, 0.38)'
    },
    teal: {
      name: '青色',
      light: 'rgba(60, 210, 200, 0.30)',
      strong: 'rgba(0, 140, 140, 0.78)',
      lightDark: 'rgba(60, 210, 200, 0.24)',
      strongDark: 'rgba(0, 180, 175, 0.70)',
      mark: 'rgba(60, 210, 200, 0.50)',
      markDark: 'rgba(60, 210, 200, 0.38)'
    }
  };

  function get(name) {
    return PRESETS[name] || PRESETS.amber;
  }

  /** 一套 ::highlight 规则；!important 用来压过 page.css 的兜底默认色。 */
  function css(theme) {
    const t = theme || PRESETS.amber;
    return (
      '::highlight(sts-all){background-color:' + t.light + ' !important;}' +
      '::highlight(sts-active){background-color:' + t.strong + ' !important;}' +
      '@media (prefers-color-scheme:dark){' +
      '::highlight(sts-all){background-color:' + t.lightDark + ' !important;}' +
      '::highlight(sts-active){background-color:' + t.strongDark + ' !important;}' +
      '}'
    );
  }

  STS.Theme = { PRESETS, get, css };
})(window);
