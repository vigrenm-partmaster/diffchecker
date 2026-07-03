// End-to-end check: drives index.html in headless Chromium and asserts the
// diff output for the synthetic fixtures (and, when present, real sample CSVs).
//
// Usage:
//   node scripts/make-fixtures.mjs
//   node scripts/e2e.mjs [--samples <dir-with-real-csvs>] [--shots <dir>]
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const samplesDir = opt('--samples');
const shotsDir = opt('--shots') || root;

let failures = 0;
function check(cond, msg){
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('  FAIL ' + msg); }
}

async function launch(){
  try { return await chromium.launch(); }
  catch {
    for (const cand of ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']){
      if (existsSync(cand)) return chromium.launch({ executablePath: cand });
    }
    throw new Error('no chromium found');
  }
}

async function freshPage(browser){
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', e => { failures++; console.error('  FAIL page error: ' + e.message); });
  await page.goto('file://' + join(root, 'index.html'));
  return page;
}

// state.leftFiles/rightFiles are filled synchronously by the change handler and
// process() sets a non-empty #status in the same tick, so once the counts match
// AND status is empty again, the run covering both sides has finished.
async function waitDone(page, nLeft, nRight){
  await page.waitForFunction(([l, r]) =>
    window.DC && DC.state.leftFiles.length === l && DC.state.rightFiles.length === r &&
    DC.state.result && document.querySelector('#status').textContent === '',
    [nLeft, nRight], { timeout: 30000 });
  await page.waitForTimeout(250); // let chunked rendering finish
}

const cardTexts = page => page.$$eval('#summary .pair-card', els => els.map(e => e.textContent));

async function typeSearch(page, term){
  await page.fill('#search', term);
  await page.waitForTimeout(260); // debounce (150ms) + render
}
// rows visible in the result blocks that do NOT contain the term = leaks
const leakCount = (page, term) => page.$$eval('#results .block tbody tr:not(.more)',
  (trs, t) => trs.filter(tr => !tr.textContent.toLowerCase().includes(t)).length, term);
const shownRows = page => page.$$eval('#results .block tbody tr:not(.more)', trs => trs.length);

async function testSynthetic(browser){
  console.log('\n== synthetic fixtures ==');
  const fx = f => join(root, 'fixtures', f);
  const page = await freshPage(browser);
  await page.setInputFiles('#input-left', [fx('a_before.csv'), fx('b_before.csv'), fx('c_swapped_after.csv'), fx('wb_before.xlsx')]);
  await page.setInputFiles('#input-right', [fx('a_after.csv'), fx('b_after.csv'), fx('c_swapped_before.csv'), fx('wb_after.xlsx')]);
  await waitDone(page, 4, 4);

  const cards = await cardTexts(page);
  check(cards.length === 5, '5 matched pairs (got ' + cards.length + ')');
  check((await page.$$('#summary .unmatched-card')).length === 0, 'no unmatched tables');

  const cardFor = frag => cards.find(t => t.includes(frag)) || '';
  const a = cardFor('a_before.csv');
  check(a.includes('key: id'), 'pair A uses key "id"');
  check(a.includes('+1 rows') && a.includes('−1 rows') && a.includes('~2 rows') && a.includes('~2 cells'), 'pair A stats (+1/−1/~2 rows, ~2 cells): ' + a);
  const b = cardFor('b_before.csv');
  check(b.includes('sequence-aligned'), 'pair B falls back to sequence alignment');
  check(b.includes('+1 rows') && b.includes('~1 rows') && !b.includes('−'), 'pair B stats (+1 rows, ~1 rows, fuzzy change): ' + b);
  const c = cardFor('c_swapped_after.csv');
  check(c.includes('c_swapped_after.csv') && c.includes('c_swapped_before.csv'), 'pair C paired by content despite swapped names');
  check(c.includes('+1 cols') && c.includes('−1 cols'), 'pair C column add/remove: ' + c);
  const wbStatic = cards.find(t => t.includes('Static')) || '';
  check(wbStatic.includes('identical'), 'wb Static sheet identical');
  const wbData = cards.find(t => t.includes('Data')) || '';
  check(wbData.includes('+1 rows') && wbData.includes('~1 rows'), 'wb Data sheet stats: ' + wbData);

  check(await page.$$eval('tr.r-added', e => e.length) === 3, '3 added rows highlighted');
  check(await page.$$eval('tr.r-removed', e => e.length) === 1, '1 removed row highlighted');
  check(await page.$$eval('tr.r-changed', e => e.length) === 4, '4 changed rows highlighted');
  check(await page.$$eval('td.chg', e => e.length) === 4, '4 changed cells (blue, right side)');
  check(await page.$$eval('td.spacer', e => e.length) > 0, 'spacer cells keep rows horizontally aligned');

  // alignment invariant: every row entry occupies one TR spanning both halves
  const misaligned = await page.evaluate(() => {
    let bad = 0;
    for (const d of DC.state.result.diffs)
      for (const e of d.entries)
        if ((e.li == null) === (e.ri == null) && e.li == null) bad++;
    return bad;
  });
  check(misaligned === 0, 'no entry lacks both sides');

  // unit spot-checks through the exposed DC API
  const unit = await page.evaluate(() => {
    const out = {};
    out.canon = DC.canonCell(' 1.0 ') === '1' && DC.canonCell('007') === '7' && DC.canonCell('abc ') === 'abc';
    const ops = DC.seqDiffDP(['a', 'b', 'c'], ['a', 'x', 'b', 'c']);
    out.dp = JSON.stringify(ops.map(o => o.t)) === JSON.stringify(['m', 'i', 'm', 'm']);
    return out;
  });
  check(unit.canon, 'canonCell normalizes numbers, trims text');
  check(unit.dp, 'seqDiffDP basic LCS diff');

  // --- row search / filter ---
  await typeSearch(page, 'washer'); // present only in pair A (a_before/a_after)
  const sBlocks = await page.$$eval('#results .pair-block .names', els => els.map(e => e.textContent));
  check(sBlocks.length === 1 && sBlocks[0].includes('a_before.csv'), 'search "washer" shows only pair A: ' + JSON.stringify(sBlocks));
  check(await leakCount(page, 'washer') === 0, 'no non-matching rows leak through search');
  check(await shownRows(page) >= 1, 'search shows the matching rows');
  check(await page.$$eval('#results .pair-block tbody tr.r-same', trs => trs.length) >= 1,
    'search reveals unchanged matching rows (overrides show-only-differences)');
  check(/\d+ rows? match/.test(await page.$eval('#results .pair-block .cnt', e => e.textContent)),
    'count label reads "N rows match"');
  await typeSearch(page, 'no-such-value-xyz');
  check((await page.$$('#results .block')).length === 0 && /No rows contain/.test(await page.$eval('#results', e => e.textContent)),
    'search with no matches shows the empty message');
  await typeSearch(page, ''); // clear
  check((await page.$$('#results .pair-block')).length === 5, 'clearing search restores all 5 pair blocks');

  await page.screenshot({ path: join(shotsDir, 'e2e-synthetic.png'), fullPage: true });
  await page.close();
}

async function testSamples(browser){
  const dir = resolve(samplesDir);
  const all = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.csv'));
  const after = all.filter(f => f.includes('(after)')).map(f => join(dir, f));
  const before = all.filter(f => !f.includes('(after)')).map(f => join(dir, f));
  console.log(`\n== real samples (${before.length} before / ${after.length} after) ==`);
  const page = await freshPage(browser);
  await page.setInputFiles('#input-left', before);
  await page.setInputFiles('#input-right', after);
  const t0 = Date.now();
  await waitDone(page, before.length, after.length);
  console.log('  processed in ' + (Date.now() - t0) + ' ms');

  const errs = await page.evaluate(() => DC.state.errors);
  if (errs.length) console.error('  page-side parse errors: ' + errs.join(' | '));
  const cards = await cardTexts(page);
  check(cards.length === before.length, before.length + ' matched pairs (got ' + cards.length + ')');
  // each pair must join a file with its own "(after)" twin — content pairing sanity
  for (const t of cards){
    const m = t.match(/^(.*?\.csv)\s*→\s*(.*?\.csv)/);
    const okPair = m && m[2].replace(' (after)', '') === m[1];
    check(!!okPair, 'correct partner: ' + (m ? m[1] + ' → ' + m[2] : t.slice(0, 80)));
    console.log('       ' + (t.match(/(key: [^·]*|sequence-aligned[^·]*)/) || ['?'])[0].trim());
  }
  const unmatched = await page.$$eval('#summary .unmatched-card .names', els => els.map(e => e.textContent));
  check(unmatched.length === 1 && unmatched[0].includes('engTransferHistory'), 'engTransferHistory reported as added file');
  const headerOk = await page.$$eval('table.diff thead th', ths => !ths.some(th => /ï»¿|﻿/.test(th.textContent)));
  check(headerOk, 'no BOM residue in headers');
  await page.screenshot({ path: join(shotsDir, 'e2e-samples.png'), fullPage: true });

  // --- row search on a real part number ---
  const part = '182-71-1';
  await typeSearch(page, part);
  const nShown = await shownRows(page);
  check(nShown >= 1, 'search "' + part + '" shows matching rows (' + nShown + ')');
  check(await leakCount(page, part) === 0, 'every visible sample row contains "' + part + '"');
  console.log('  "' + part + '" matched ' + nShown + ' rows across ' + (await page.$$('#results .block')).length + ' comparisons');
  await page.screenshot({ path: join(shotsDir, 'e2e-samples-search.png'), fullPage: true });
  await typeSearch(page, '');
  check((await page.$$eval('#results .pair-block .cnt', els => els.some(e => /differing rows|identical|column changes/.test(e.textContent)))),
    'clearing search restores the diff view');

  await page.close();
}

const browser = await launch();
await testSynthetic(browser);
if (samplesDir && existsSync(samplesDir)) await testSamples(browser);
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
