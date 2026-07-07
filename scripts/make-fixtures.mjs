// Generates small synthetic CSV/XLSX fixtures for the e2e checks.
// Usage: node scripts/make-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.full.min.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fixtures');
mkdirSync(out, { recursive: true });

const csv = rows => rows.map(r => r.join(',')).join('\r\n') + '\r\n';
const BOM = '\ufeff';

// --- pair A: key column `id`; 1 row added, 1 removed, 2 cells changed, rows reordered ---
const aBefore = [
  ['id', 'name', 'qty', 'price'],
  ['1', 'bolt', '10', '0.5'],
  ['2', 'nut', '20', '0.3'],
  ['3', 'washer', '30', '0.1'],
  ['4', 'screw', '40', '0.7'],
  ['5', 'rivet', '50', '0.2'],
];
const aAfter = [
  ['id', 'name', 'qty', 'price'],
  ['3', 'washer', '30', '0.1'],
  ['1', 'bolt', '12', '0.5'],     // qty changed
  ['2', 'nut', '20', '0.35'],     // price changed
  ['5', 'rivet', '50', '0.2'],
  ['6', 'dowel', '60', '0.9'],    // added (id 4 removed)
];
writeFileSync(join(out, 'a_before.csv'), BOM + csv(aBefore));
writeFileSync(join(out, 'a_after.csv'), BOM + csv(aAfter));

// --- pair B: no usable key (dup values); mid-file insertion + a 1-cell edit -> fuzzy pass ---
// every column (and combo) has duplicates, so no key can be detected
const bBefore = [
  ['type', 'status', 'note'],
  ['x', 'open', 'a'],
  ['x', 'open', 'a'],
  ['y', 'closed', 'b'],
  ['x', 'open', 'a'],
  ['y', 'open', 'b'],
];
const bAfter = [
  ['type', 'status', 'note'],
  ['x', 'open', 'a'],
  ['x', 'open', 'a'],
  ['z', 'new', 'c'],              // inserted row
  ['y', 'closed', 'b'],
  ['x', 'done', 'a'],             // status changed -> fuzzy "changed", not removed+added
  ['y', 'open', 'b'],
];
writeFileSync(join(out, 'b_before.csv'), BOM + csv(bBefore));
writeFileSync(join(out, 'b_after.csv'), BOM + csv(bAfter));

// --- pair C: added + removed column (filenames deliberately SWAPPED to test content pairing) ---
const cBefore = [
  ['code', 'city', 'zone', 'obsolete'],
  ['AA', 'Lund', 'S', 'x'],
  ['BB', 'Umea', 'N', 'y'],
  ['CC', 'Gavle', 'C', 'z'],
];
const cAfter = [
  ['code', 'city', 'zone', 'region'],
  ['AA', 'Lund', 'S', 'Skane'],
  ['BB', 'Umea', 'N', 'Norrland'],
  ['CC', 'Gavle', 'C', 'Gastrikland'],
];
// NOTE the swap: the "before" content is written into *swapped_after.csv* and vice versa.
writeFileSync(join(out, 'c_swapped_after.csv'), BOM + csv(cBefore));
writeFileSync(join(out, 'c_swapped_before.csv'), BOM + csv(cAfter));

// --- pair D: xlsx workbooks, 2 sheets each: "Static" identical, "Data" modified ---
function wb(dataRows) {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
    ['setting', 'value'],
    ['mode', 'auto'],
    ['limit', '100'],
  ]), 'Static');
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(dataRows), 'Data');
  return w;
}
const saveWb = (w, file) => writeFileSync(file, XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }));
saveWb(wb([
  ['part', 'rev', 'state'],
  ['P-1', 'A', 'released'],
  ['P-2', 'A', 'draft'],
  ['P-3', 'B', 'released'],
]), join(out, 'wb_before.xlsx'));
saveWb(wb([
  ['part', 'rev', 'state'],
  ['P-1', 'B', 'released'],   // rev changed
  ['P-2', 'A', 'draft'],
  ['P-3', 'B', 'released'],
  ['P-4', 'A', 'draft'],      // added
]), join(out, 'wb_after.xlsx'));

// --- pair E: composite key + reordering + a VOLATILE near-unique column ---
// Identity key is site+part+rev. `ts` is nearly unique and would form a passing
// 2-col key (part+ts), but it changes on ~30% of rows, so a naive "prefer fewer
// columns" detector mis-picks it and mis-aligns reordered rows. The fix must pick
// site+part+rev (overlap 1.0) over part+ts (overlap < 1).
const eBefore = [
  ['site', 'part', 'rev', 'ts', 'val'],
  ['111', 'P-100', 'A', '2024-01-01T10:00:00Z', '10'],
  ['111', 'P-100', 'B', '2024-01-02T10:00:00Z', '11'],
  ['241', 'P-100', 'A', '2024-01-03T10:00:00Z', '12'],
  ['241', 'P-200', 'A', '2024-02-01T10:00:00Z', '20'],
  ['241', 'P-200', 'B', '2024-02-02T10:00:00Z', '21'],
  ['271', 'P-200', 'A', '2024-02-03T10:00:00Z', '22'],
  ['271', 'P-300', 'A', '2024-03-01T10:00:00Z', '30'],
  ['271', 'P-300', 'B', '2024-03-02T10:00:00Z', '31'],
  ['111', 'P-900', 'A', '2024-09-01T10:00:00Z', '90'], // removed in after
];
// after: same identities, REORDERED, ts changed on several rows (re-transfer),
// one val changed, P-900 removed, P-400 added.
const eAfter = [
  ['site', 'part', 'rev', 'ts', 'val'],
  ['271', 'P-300', 'A', '2024-03-01T10:00:00Z', '30'],
  ['241', 'P-200', 'A', '2026-06-10T19:40:00Z', '20'], // ts changed
  ['111', 'P-100', 'A', '2024-01-01T10:00:00Z', '10'],
  ['241', 'P-100', 'A', '2026-06-10T19:40:00Z', '12'], // ts changed
  ['271', 'P-200', 'A', '2026-06-10T19:40:00Z', '22'], // ts changed
  ['111', 'P-100', 'B', '2024-01-02T10:00:00Z', '99'], // val changed 11->99
  ['241', 'P-200', 'B', '2024-02-02T10:00:00Z', '21'],
  ['271', 'P-300', 'B', '2024-03-02T10:00:00Z', '31'],
  ['241', 'P-400', 'A', '2026-06-10T19:40:00Z', '40'], // added
];
writeFileSync(join(out, 'e_before.csv'), BOM + csv(eBefore));
writeFileSync(join(out, 'e_after.csv'), BOM + csv(eAfter));

console.log('fixtures written to', out);
