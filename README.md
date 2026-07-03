# diffchecker

Compare CSV / Excel files **before vs after** — entirely in the browser. Open `index.html` (or the GitHub Pages site) and drop files on the two sides; nothing is uploaded anywhere.

## What it does

- **Left = Before, right = After.** Upload one or many files per side (`.csv`, `.xlsx`, `.xls`; every Excel sheet is treated as its own table).
- **Files are matched by content**, not by name: header overlap, row-content overlap and shape decide which Before file pairs with which After file (filename is only a small tiebreaker). Files without a partner are reported as *Added* / *Removed*.
- **Rows are aligned on the same horizontal line.** A key column (or 2–3 column combination) is auto-detected when one exists — so reordered rows still pair up — with a sequence-alignment fallback otherwise. One-sided rows get a hatched spacer on the other side.
- **Differences are highlighted on the After side**: light green = added rows/columns, light red = removed, light blue = changed cells (showing the new value; the old value is on the left, same row).
- **Summary on top**: one card per file pair with `+rows / −rows / ~rows / ±cols / ~cells` badges, match confidence and the key used; click a card to jump to that comparison. Unchanged rows are collapsed by default ("Show only differences").

## Notes

- CSV parsing handles UTF-8 BOMs, `;` delimiters and CRLF line endings automatically; numbers are compared numerically (`1.0` equals `1`).
- Header detection is automatic with a manual override in the toolbar ("First row is header").
- Comfortably handles ~50k rows per file.

## Development

Everything lives in `index.html` (vanilla JS/CSS); `vendor/` holds the two parsing libraries ([SheetJS](https://sheetjs.com) and [PapaParse](https://www.papaparse.com)) so the page works fully offline.

```bash
npm install          # dev-only: Playwright for the e2e checks
npm run e2e          # regenerates fixtures/ and drives the page in headless Chromium
node scripts/e2e.mjs --samples <dir>   # additionally run against your own CSVs
```

The app's internals are exposed as `window.DC` for testing (`DC.pairTables`, `DC.detectKey`, `DC.diffPair`, …).
