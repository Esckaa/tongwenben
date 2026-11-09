/* 核心逻辑自测：不依赖扩展环境，直接跑在普通页面里。
 * 用 --dump-dom 抓取 #out 的结果即可。
 */
(function () {
  'use strict';

  const results = [];

  function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  }

  const fixture = document.getElementById('fixture');
  const map = STS.TextMap.build(fixture);
  map.norm = STS.Search.normalizeWithMap(map.text);
  map.headings = map.headings.map((h) => ({
    level: h.level,
    start: h.start,
    end: h.end,
    text: STS.TextMap.sliceRaw(map, h.start, h.end).replace(/\s+/g, ' ').trim()
  }));

  function find(text, limit) {
    return STS.Search.findExact(map, STS.Search.normalizeNeedle(text), limit || 100);
  }

  function rawOf(hit) {
    const r = STS.Search.toRawRange(map, hit);
    return { r, text: map.text.slice(r.start, r.end) };
  }

  /* 1. 索引与跨标签拼接 */
  check('fixture-built', map.text.length > 0, map.text.length);
  check(
    'split-text-joined',
    map.text.indexOf('人工智能技术') !== -1,
    JSON.stringify(map.text.slice(0, 60))
  );

  /* 2. 精确命中 + Range 映射 */
  const hitSplit = find('人工智能技术');
  check('split-count', hitSplit.length === 1, hitSplit.length);

  if (hitSplit.length) {
    const rr = STS.Search.toRawRange(map, hitSplit[0]);
    const range = STS.TextMap.rangeFor(map, rr.start, rr.end);
    check('split-range-text', range && range.toString() === '人工智能技术', range && range.toString());
    check(
      'split-range-rects',
      range && range.getClientRects().length >= 2,
      range && range.getClientRects().length
    );
  } else {
    check('split-range-text', false, 'no hit');
    check('split-range-rects', false, 'no hit');
  }

  /* 3. 块级边界：不能把两段拼成一句 */
  check('block-sep-present', map.text.indexOf('\u0001') !== -1, 'sep');
  check('no-cross-block-1', find('foobar').length === 0, find('foobar').length);
  check('no-cross-block-2', find('foo bar').length === 0, find('foo bar').length);
  check('block-foo', find('foo').length === 1, find('foo').length);
  check('block-bar', find('bar').length === 1, find('bar').length);

  /* 4. 全半角 + 大小写 + 偏移准确 */
  const hitAI = find('AI');
  check('fullwidth-count', hitAI.length === 2, hitAI.length);
  if (hitAI.length === 2) {
    check('fullwidth-raw-0', rawOf(hitAI[0]).text === 'ＡＩ', rawOf(hitAI[0]).text);
    check('fullwidth-raw-1', rawOf(hitAI[1]).text === 'AI', rawOf(hitAI[1]).text);
  } else {
    check('fullwidth-raw-0', false, 'no hit');
    check('fullwidth-raw-1', false, 'no hit');
  }
  check('fullwidth-needle', find('ＡＩ').length === 2, find('ＡＩ').length);

  /* 5. 空白折叠 */
  check('whitespace-collapse', find('hello world').length === 1, find('hello world').length);
  check('whitespace-needle', find('  hello   world  ').length === 1, find('  hello   world  ').length);

  /* 6. 大小写 */
  check('case-insensitive', find('hello').length === 4, find('hello').length);
  check('case-insensitive-2', find('HELLO').length === 4, find('HELLO').length);

  /* 7. 隐藏内容不索引 */
  check('hidden-display-none', find('needle').length === 1, find('needle').length);
  check('hidden-text-absent-1', !map.text.includes('needle hidden'), 'display:none');
  check('hidden-text-absent-2', !map.text.includes('needle invisible'), 'visibility:hidden');

  /* 8. 弯引号归一 */
  check('curly-quote', find('"quote"').length === 2, find('"quote"').length);
  check('curly-quote-needle', find('“quote”').length === 2, find('“quote”').length);

  /* 9. 上限 */
  check('limit-respected', find('hello', 2).length === 2, find('hello', 2).length);

  /* 10. 摘要里不出现哨兵 */
  check(
    'snippet-no-sep',
    STS.TextMap.sliceRaw(map, 0, map.text.length).indexOf('\u0001') === -1,
    'slice'
  );

  /* 11. 高亮 API */
  check(
    'highlight-api',
    !!(window.CSS && CSS.highlights && typeof window.Highlight === 'function'),
    'CSS.highlights'
  );

  /* 12. 标题索引（分组用） */
  check('headings-count', map.headings.length === 2, map.headings.length);
  check(
    'heading-text',
    !!(map.headings[0] && map.headings[0].text.indexOf('Chapter One') !== -1),
    map.headings[0] && map.headings[0].text
  );
  check(
    'heading-order',
    !!(map.headings[0] && map.headings[1] && map.headings[0].start < map.headings[1].start),
    map.headings.map((h) => h.start).join(',')
  );

  /* 13. 近似兜底：题干整句在原文里没有逐字出现 */
  const fb = STS.Fallback.find(map, 'What role does carbon dioxide play in warming?', 3);
  check('fallback-found', fb.items.length >= 1, fb.items.length);
  check(
    'fallback-score',
    !!(fb.items[0] && fb.items[0].score >= 30),
    fb.items[0] && fb.items[0].score
  );
  check(
    'fallback-range',
    !!(fb.items[0] && fb.items[0].range.toString().toLowerCase().indexOf('carbon') !== -1),
    fb.items[0] && fb.items[0].range.toString()
  );

  /* 输出 */
  const out = document.getElementById('out');
  const lines = results.map((r) =>
    r.ok ? 'PASS ' + r.name : 'FAIL ' + r.name + ' | ' + r.detail
  );
  const failed = results.filter((r) => !r.ok).length;
  lines.push(failed ? 'FAILURES ' + failed : 'ALL PASS ' + results.length);
  out.textContent = lines.join('\n');

  for (const line of lines) console.log(line);
})();
