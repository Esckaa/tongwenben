/* 同文本检索 · 近似兜底
 *
 * 完全一致一处都没有时，用「关键词覆盖」在页面里找最相近的句子：
 *   1. 把选区切成英文词 / 中文二元组，去掉停用词；
 *   2. 把页面切成句子，逐句算选区关键词被覆盖了多少；
 *   3. 覆盖率达到阈值且至少命中 2 个词才保留，按覆盖率降序。
 *
 * 这只是「找最像的段落」，不承诺语义等价。
 */
(function (global) {
  'use strict';

  const STS = (global.STS = global.STS || {});
  const SEP = '\u0001';

  const STOP = new Set(
    (
      'a an the and or but if then than that this these those of to in on at for from by ' +
      'with without about into over after before between during is are was were be been ' +
      'being am do does did doing have has had having it its as not no so such can could ' +
      'may might will would should must shall i you he she they we him her them his their ' +
      'our your my me us who whom which what when where why how all any both each few more ' +
      'most other some only own same very just also there here'
    ).split(/\s+/)
  );

  const TOKEN_RE = /[a-z0-9\u00c0-\u024f]+|[\u3400-\u9fff]+/g;
  const SEGMENT_RE = /[^\u0001.!?\u3002\uff01\uff1f;\uff1b]+/g;

  function isCjk(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  /**
   * 把一段归一化文本切成可比较的 token。
   * @param {string} str
   * @param {number} offset 该段在整页归一化文本中的起始下标
   */
  function tokenize(str, offset) {
    const out = [];
    TOKEN_RE.lastIndex = 0;

    let m;
    while ((m = TOKEN_RE.exec(str))) {
      const text = m[0];
      const start = offset + m.index;

      if (isCjk(text)) {
        if (text.length === 1) {
          out.push({ text, ns: start, ne: start + 1 });
        } else {
          for (let i = 0; i < text.length - 1; i += 1) {
            out.push({ text: text.slice(i, i + 2), ns: start + i, ne: start + i + 2 });
          }
        }
      } else if (text.length >= 2 && !STOP.has(text)) {
        out.push({ text, ns: start, ne: start + text.length });
      }
    }

    return out;
  }

  function clipSnippet(text, side) {
    if (text.length <= 70) return text;
    return side === 'before' ? '…' + text.slice(-70) : text.slice(0, 70) + '…';
  }

  /**
   * @param {object} map 已带 norm 的文本索引
   * @param {string} needleRaw 选区原文
   * @param {number} limit 最多返回几条
   * @returns {{items:Array, total:number, scanned:number}}
   */
  function find(map, needleRaw, limit) {
    const max = limit || 3;
    const needleNorm = STS.Search.normalizeNeedle(needleRaw);
    const needleTokens = tokenize(needleNorm, 0);
    const needleSet = new Set(needleTokens.map((t) => t.text));

    if (needleSet.size < 2) {
      return { items: [], total: 0, scanned: 0 };
    }

    const text = map.norm.text;
    const candidates = [];
    let scanned = 0;

    SEGMENT_RE.lastIndex = 0;
    let seg;
    while ((seg = SEGMENT_RE.exec(text))) {
      const s = seg.index;
      const e = s + seg[0].length;
      if (e - s < 10 || e - s > 800) continue;

      scanned += 1;
      if (scanned > 4000) break;

      const tokens = tokenize(seg[0], s);
      if (tokens.length < 2) continue;

      const matchedTexts = new Set();
      let first = null;
      let last = null;

      for (const token of tokens) {
        if (!needleSet.has(token.text)) continue;
        matchedTexts.add(token.text);
        if (!first) first = token;
        last = token;
      }

      if (!first || matchedTexts.size < 2) continue;

      const coverage = matchedTexts.size / needleSet.size;
      if (coverage < 0.3) continue;

      const rawSegStart = map.norm.starts[s];
      const rawSegEnd = map.norm.ends[e - 1];
      const rawStart = map.norm.starts[first.ns];
      const rawEnd = map.norm.ends[last.ne - 1];

      const range = STS.TextMap.rangeFor(map, rawStart, rawEnd);
      if (!range) continue;

      const before = clipSnippet(
        STS.TextMap.sliceRaw(map, rawSegStart, rawStart).replace(/\s+/g, ' ').replace(/^\s+/, ''),
        'before'
      );
      const after = clipSnippet(
        STS.TextMap.sliceRaw(map, rawEnd, rawSegEnd).replace(/\s+/g, ' ').replace(/\s+$/, ''),
        'after'
      );
      const hit = STS.TextMap.sliceRaw(map, rawStart, rawEnd).replace(/\s+/g, ' ');

      candidates.push({
        before,
        hit,
        after,
        range,
        rawStart,
        rawEnd,
        score: Math.round(coverage * 100),
        matched: matchedTexts.size,
        needleWords: needleSet.size
      });
    }

    candidates.sort((a, b) => b.score - a.score || b.matched - a.matched || a.rawStart - b.rawStart);

    // 去掉互相重叠的候选，避免同一句出现两遍
    const picked = [];
    for (const c of candidates) {
      const overlap = picked.some((p) => c.rawStart < p.rawEnd && c.rawEnd > p.rawStart);
      if (!overlap) picked.push(c);
      if (picked.length >= max) break;
    }

    return { items: picked, total: candidates.length, scanned };
  }

  STS.Fallback = { find, tokenize, STOP, SEP };
})(window);
