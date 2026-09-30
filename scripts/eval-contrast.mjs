// Kontrast-Modul: die eindeutigen Kontrastfälle aus AccessGuru exakt nachstellen.
//   Variante A: Hintergrund auf dem Textelement selbst
//   Variante B: Hintergrund auf dem Elternelement, Textelement transparent
// Jede Ergebnistabelle muss sich auf N summieren – sonst bricht das Skript ab.
import { launch, openPage, injectAugmentAble, saveJson, meta } from '../harness/core.mjs';
import { loadViolations, parsePyDict } from '../harness/dataset.mjs';

// ─── Fälle ────────────────────────────────────────────────────────────────────────
const rows = loadViolations().filter((v) => v.violation_name === 'color-contrast' || v.violation_name === 'color-contrast-enhanced');
const seen = new Map();
let unparsable = 0;
for (const r of rows) {
  const s = parsePyDict(r.supplementary_information);
  if (!s || !s.fgColor || !s.bgColor) { unparsable++; continue; }
  const px = parseFloat((String(s.fontSize).match(/([\d.]+)px/) || [])[1]);
  const key = [r.violation_name, s.fgColor, s.bgColor, s.fontSize, s.fontWeight].join('|');
  if (!seen.has(key)) {
    seen.set(key, {
      id: seen.size, rule: r.violation_name, fg: s.fgColor, bg: s.bgColor, fontSizeRaw: s.fontSize, px,
      weight: s.fontWeight, agRatio: s.contrastRatio, expected: parseFloat(s.expectedContrastRatio), pages: [r.html_file_name],
    });
  } else seen.get(key).pages.push(r.html_file_name);
}
const cases = [...seen.values()];
console.log(`Kontrast-Annotationen: ${rows.length}, eindeutige Fälle: ${cases.length}, nicht lesbar: ${unparsable}`);

// ─── WCAG-Kontrast ───────────────────────────────────────────────────────────────────────
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgb = (s) => { const m = String(s).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
const lum = (c) => c.reduce((s, v, i) => { v /= 255; v = v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const weightNum = (w) => (w === 'bold' ? 700 : w === 'normal' || w == null ? 400 : +w);
const isLargeWcag = (c) => c.px >= 24 || (weightNum(c.weight) >= 700 && c.px >= 18.66);

for (const c of cases) {
  c.fgRgb = hex(c.fg); c.bgRgb = hex(c.bg);
  c.r0 = ratio(c.fgRgb, c.bgRgb);
  c.large = isLargeWcag(c);
  // Original-Schwelle = was axe verlangt hat (expectedContrastRatio); AA-Schwelle je nach Textgröße
  c.tOrig = c.expected || (c.rule === 'color-contrast' ? (c.large ? 3 : 4.5) : (c.large ? 4.5 : 7));
  c.tAA = c.large ? 3 : 4.5;
}

// ─── Browserlauf ─────────────────────────────────────────────────────────────────────────
function buildHtml(variant) {
  const items = cases.map((c) => {
    const font = `font-size:${c.px}px;font-weight:${c.weight};font-family:Arial,sans-serif`;
    return variant === 'A'
      ? `<div class="case"><span data-case="${c.id}" style="color:${c.fg};background-color:${c.bg};${font}">Beispieltext ${c.id}</span></div>`
      : `<div class="case" style="background-color:${c.bg}"><span data-case="${c.id}" style="color:${c.fg};${font}">Beispieltext ${c.id}</span></div>`;
  }).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kontrastfälle ${variant}</title></head><body><main>${items}</main></body></html>`;
}

const browser = await launch();
const variants = {};
for (const variant of ['A', 'B']) {
  const { page, context } = await openPage(browser, { pageId: 'contrast-' + variant, baseUrl: 'https://contrast.test/' + variant, html: buildHtml(variant) });
  const { injectError } = await injectAugmentAble(page);
  if (injectError) throw new Error('Skriptfehler: ' + injectError);
  const after = await page.evaluate(() => [...document.querySelectorAll('[data-case]')].map((el) => {
    const s = getComputedStyle(el);
    return { id: +el.dataset.case, color: s.color, ownBg: s.backgroundColor, marker: el.getAttribute('data-a11y-contrast'), fontSize: s.fontSize, fontWeight: s.fontWeight };
  }));
  await context.close();
  variants[variant] = classify(after);
}
await browser.close();

function classify(after) {
  const byId = new Map(after.map((a) => [a.id, a]));
  const out = cases.map((c) => {
    const a = byId.get(c.id);
    const fg1 = rgb(a.color);
    const r1 = ratio(fg1, c.bgRgb);
    const changed = fg1.join() !== c.fgRgb.join();
    const touched = a.marker === '1';
    // Sicht des Skripts: eigener Hintergrund, eigene Größen-/Schwellenlogik (nur AA)
    const scriptBg = rgb(a.ownBg) && a.ownBg !== 'rgba(0, 0, 0, 0)' ? rgb(a.ownBg) : null;
    const scriptLarge = parseFloat(a.fontSize) >= 24 || (parseInt(a.fontWeight) >= 700 && parseFloat(a.fontSize) >= 18.66);
    const scriptT = scriptLarge ? 3 : 4.5;
    const scriptR = scriptBg ? ratio(c.fgRgb, scriptBg) : null;
    return {
      ...c, color1: a.color, r1, changed, touched, black: fg1.join() === '0,0,0',
      script: { sieht_bg: !!scriptBg, ratio: scriptR, schwelle: scriptT, gross: scriptLarge },
      orig: outcome(c.r0, r1, c.tOrig, touched, changed),
      aa: outcome(c.r0, r1, c.tAA, touched, changed),
    };
  });
  return out;
}

// Eine Zeile je Ausgang; die Zeilen schließen sich gegenseitig aus.
function outcome(r0, r1, T, touched, changed) {
  const eps = 1e-9;
  if (r0 >= T - eps) {
    if (!touched && !changed) return 'war schon ok';
    return r1 >= T - eps ? 'war ok, trotzdem geändert' : 'war ok, durch Skript unter Schwelle';
  }
  if (!touched && !changed) return 'unter Schwelle, nicht angefasst';
  if (!changed) return 'markiert, Farbe unverändert';
  if (r1 >= T - eps) return 'behoben';
  if (r1 > r0 + eps) return 'verbessert, reicht nicht';
  if (r1 < r0 - eps) return 'verschlechtert';
  return 'geändert, Kontrast gleich';
}

const OUTCOMES = ['behoben', 'verbessert, reicht nicht', 'verschlechtert', 'geändert, Kontrast gleich', 'markiert, Farbe unverändert',
  'unter Schwelle, nicht angefasst', 'war schon ok', 'war ok, trotzdem geändert', 'war ok, durch Skript unter Schwelle'];

// ─── Tabellen + Konsistenzprüfung ──────────────────────────────────────────
const summary = {};
for (const [v, res] of Object.entries(variants)) {
  const tab = (k) => Object.fromEntries(OUTCOMES.map((o) => [o, res.filter((r) => r[k] === o).length]));
  const s = {
    n: res.length,
    orig: tab('orig'), aa: tab('aa'),
    angefasst: res.filter((r) => r.touched).length,
    farbe_geaendert: res.filter((r) => r.changed).length,
    unter_aa_vorher: res.filter((r) => r.r0 < r.tAA).length,
    unter_aa_nicht_angefasst: res.filter((r) => r.r0 < r.tAA && !r.touched),
    schwarz: res.filter((r) => r.black && r.changed).length,
    schwarz_nach_ausgang: {},
    dunkler_bg_bei_verschlechterung: res.filter((r) => r.orig === 'verschlechtert' && (r.bgRgb[0] + r.bgRgb[1] + r.bgRgb[2]) / 3 < 128).length,
    ag_ratio_abweichung: res.filter((r) => r.agRatio && Math.abs(r.agRatio - r.r0) > 0.05).length,
    nach_regel: {},
    verschlechtert: res.filter((r) => r.orig === 'verschlechtert').map(({ rule, fg, bg, fontSizeRaw, weight, r0, r1, color1, pages }) => ({ rule, fg, bg, fontSizeRaw, weight, r0, r1, color1, seiten: pages.length })),
  };
  for (const r of res.filter((r) => r.black && r.changed)) s.schwarz_nach_ausgang[r.orig] = (s.schwarz_nach_ausgang[r.orig] || 0) + 1;
  for (const rule of ['color-contrast', 'color-contrast-enhanced']) {
    const sub = res.filter((r) => r.rule === rule);
    s.nach_regel[rule] = { n: sub.length, behoben_orig: sub.filter((r) => r.orig === 'behoben').length, behoben_aa: sub.filter((r) => r.aa === 'behoben').length };
  }
  // Invarianten
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const touchedRows = ['behoben', 'verbessert, reicht nicht', 'verschlechtert', 'geändert, Kontrast gleich', 'markiert, Farbe unverändert', 'war ok, trotzdem geändert', 'war ok, durch Skript unter Schwelle'];
  const check = [
    [sum(s.orig) === s.n, `Variante ${v}: Original-Tabelle summiert sich nicht auf N`],
    [sum(s.aa) === s.n, `Variante ${v}: AA-Tabelle summiert sich nicht auf N`],
    [touchedRows.reduce((a, k) => a + s.orig[k], 0) === res.filter((r) => r.touched || r.changed).length, `Variante ${v}: "angefasst" passt nicht zur Tabelle`],
  ];
  for (const [ok, msg] of check) if (!ok) { console.error('✗ KONSISTENZFEHLER', msg); process.exitCode = 1; }
  summary[v] = s;
  console.log(`\nVariante ${v}: angefasst ${s.angefasst}/${s.n}, unter AA vorher ${s.unter_aa_vorher}`);
  console.table(Object.fromEntries(OUTCOMES.map((o) => [o, { original: s.orig[o], AA: s.aa[o] }])));
}

saveJson('contrast.json', { meta: meta(), annotationen: rows.length, faelle: cases.length, nicht_lesbar: unparsable, summary, detail: variants });
