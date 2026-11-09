/* 同文本检索 · 归一化与精确查找
 *
 * 归一化时逐字符记录「归一化下标 -> 原文区间」，所以大小写、全半角、
 * 空白折叠都不会让高亮错位。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});
  const SEP = '\u0001';

  const FULLWIDTH_START = 0xff01;
  const FULLWIDTH_END = 0xff5e;
  const FULLWIDTH_DELTA = 0xfee0;

  // 单字符 1:1 替换
  const PUNCT = {
    '\u2018': "'",
    '\u2019': "'",
    '\u201c': '"',
    '\u201d': '"',
    '\u2013': '-',
    '\u2014': '-',
    '\u2026': '.'
  };

  // 直接丢弃的不可见字符
  const DROP = new Set(['\u200b', '\ufeff', '\u00ad']);

  function isSpace(ch) {
    return /\s/.test(ch);
  }

  /**
   * 归一化并保留映射。
   * @param {string} raw
   * @returns {{text:string, starts:number[], ends:number[]}}
   *   starts[i] / ends[i] 是归一化第 i 个字符对应的原文区间 [start, end)
   */
  function normalizeWithMap(raw) {
    const out = [];
    const starts = [];
    const ends = [];
    const n = raw.length;
    let i = 0;

    while (i < n) {
      const ch = raw[i];

      // 段落哨兵原样保留，保证不会跨段匹配
      if (ch === SEP) {
        out.push(SEP);
        starts.push(i);
        ends.push(i + 1);
        i += 1;
        continue;
      }

      if (DROP.has(ch)) {
        i += 1;
        continue;
      }

      if (isSpace(ch)) {
        let j = i;
        while (j < n && isSpace(raw[j])) j += 1;
        out.push(' ');
        starts.push(i);
        ends.push(j);
        i = j;
        continue;
      }

      let c = ch;
      const code = c.charCodeAt(0);
      if (code >= FULLWIDTH_START && code <= FULLWIDTH_END) {
        c = String.fromCharCode(code - FULLWIDTH_DELTA);
      } else if (Object.prototype.hasOwnProperty.call(PUNCT, c)) {
        c = PUNCT[c];
      }

      const lower = c.toLowerCase();
      // toLowerCase 可能改变长度（如 İ），此时保留原字符，保证 1:1
      out.push(lower.length === 1 ? lower : c);
      starts.push(i);
      ends.push(i + 1);
      i += 1;
    }

    return { text: out.join(''), starts, ends };
  }

  /** 选区文本归一化：先 trim，再走同一套规则。 */
  function normalizeNeedle(text) {
    return normalizeWithMap(String(text).trim()).text;
  }

  /**
   * 精确查找（非重叠，逐个推进）。
   * @param {object} map  TextMap.build 的结果，且已挂上 map.norm
   * @param {string} needle normalizeNeedle 的结果
   * @param {number} limit 最多收集多少个命中
   */
  function findExact(map, needle, limit) {
    const hay = map.norm.text;
    const out = [];
    if (!needle) return out;

    let from = 0;
    while (out.length < limit) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      out.push({ ns: at, ne: at + needle.length });
      from = at + needle.length;
    }
    return out;
  }

  /** 命中 -> 原文区间 */
  function toRawRange(map, hit) {
    return {
      start: map.norm.starts[hit.ns],
      end: map.norm.ends[hit.ne - 1]
    };
  }

  STS.Search = { normalizeWithMap, normalizeNeedle, findExact, toRawRange, SEP };
})(window);
