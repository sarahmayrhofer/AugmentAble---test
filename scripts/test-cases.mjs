// Testfälle je Kritikpunkt gegen beide Skriptversionen (v140 original, v141 korrigiert).
//   npm test                 → Tabelle in der Konsole + results/tests.md
//   CASE=k4 npm test         → nur Fälle, deren id mit "k4" beginnt
// Exit-Code 1, wenn die korrigierte Version einen Fall nicht besteht.
process.env.AI_MOCK = '1'; // KI-Fälle nutzen eine Mock-Antwort, es geht nichts an HuggingFace
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { launch, openPage, injectAugmentAble, loadScript, ROOT, CONFIG } from '../harness/core.mjs';
import { CASES } from '../tests/cases.mjs';

// Testbild 300×200 (PNG, im Speicher erzeugt)
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = 120; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const FOTO = png(300, 200);

const HELPERS = () => {
  window.__name = (el) => { const ax = window.axe; ax.setup(document); try { return el.closest('[aria-hidden="true"]') ? '' : ax.commons.text.accessibleTextVirtual(ax.utils.getNodeFromTree(el)).trim(); } finally { ax.teardown(); } };
  window.__ratio = (el) => {
    const ax = window.axe; ax.setup(document);
    try { const bg = ax.commons.color.getBackgroundColor(el, []); const fg = ax.commons.color.getForegroundColor(el, false, bg); return bg && fg ? ax.commons.color.getContrast(bg, fg) : NaN; }
    finally { ax.teardown(); }
  };
};

const only = process.env.CASE;
const cases = CASES.filter((c) => !only || c.id.startsWith(only));
const versions = { original: loadScript('original'), fixed: loadScript('fixed') };
const browser = await launch();
const results = [];
for (const c of cases) {
  const row = { id: c.id, kritik: c.kritik, titel: c.titel, erwartung: c.erwartung };
  for (const [name, script] of Object.entries(versions)) {
    const { page, context } = await openPage(browser, { pageId: `test-${c.id}-${name}`, baseUrl: `https://testfall.test/${c.id}/`, html: c.html, ai: !!c.ai, extraRoutes: { 'foto.png': FOTO, 'icon.png': FOTO } });
    const { injectError } = await injectAugmentAble(page, { raw: script.raw, ai: !!c.ai });
    await page.evaluate(HELPERS);
    await page.evaluate((e) => { window.__injectError = e; }, injectError);
    if (c.axePanel) {
      await page.evaluate(async (tags) => {
        const r = await window.axe.run({ include: [['#a11y-panel']] }, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
        window.__panelViolations = r.violations.map((v) => `${v.id} (${v.nodes.length})`);
      }, CONFIG.AXE_TAGS);
    }
    let res;
    try { res = await page.evaluate(c.check); } catch (e) { res = { pass: false, detail: 'Prüfung fehlgeschlagen: ' + String(e.message).split('\n')[0] }; }
    row[name] = res;
    await context.close();
  }
  results.push(row);
  console.log(`${row.fixed.pass ? '✓' : '✗'} v141  ${row.original.pass ? '✓' : '✗'} v140  ${c.id.padEnd(34)} ${row.fixed.detail}`);
}
await browser.close();

const sym = (r) => (r.pass ? '✅' : '❌');
const md = [
  '# Testfälle je Kritikpunkt',
  '',
  `v140 (Original) besteht **${results.filter((r) => r.original.pass).length}/${results.length}**, v141 (korrigiert) besteht **${results.filter((r) => r.fixed.pass).length}/${results.length}**.`,
  '',
  '| Kritik | Testfall | Erwartung | v140 | v141 | Ergebnis v141 |',
  '| --- | --- | --- | :---: | :---: | --- |',
  ...results.map((r) => `| ${r.kritik} | ${r.titel} | ${r.erwartung} | ${sym(r.original)} ${r.original.pass ? '' : '<br><sub>' + r.original.detail.replace(/\|/g, '\\|') + '</sub>'} | ${sym(r.fixed)} | ${r.fixed.detail.replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
const out = path.join(ROOT, 'results');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'tests.md'), md);
writeFileSync(path.join(out, 'tests.json'), JSON.stringify(results, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(`\nv140: ${results.filter((r) => r.original.pass).length}/${results.length} · v141: ${results.filter((r) => r.fixed.pass).length}/${results.length} → results/tests.md`);
if (results.some((r) => !r.fixed.pass)) process.exitCode = 1;
