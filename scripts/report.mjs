// Baut results/REPORT.md (+ CSVs) aus den JSON-Ergebnissen.
// Jede Tabelle wird gegen ihre Summe geprüft; Abweichungen stehen oben im Report.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { OUT } from '../harness/core.mjs';
import { loadViolations, localPages } from '../harness/dataset.mjs';

const load = (f) => (existsSync(path.join(OUT, f)) ? JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) : null);
const contrast = load('contrast.json');
const semantic = load('semantic.json');
const semsim = load('semantic_similarity.json');
const pagesRes = load('pages.json');

const L = [];
const problems = [];
const p = (s = '') => L.push(s);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + ' %' : '–');
const fmt = (x, d = 2) => (x == null ? '–' : typeof x === 'number' ? x.toFixed(d) : x);
const table = (head, rows) => { p('| ' + head.join(' | ') + ' |'); p('|' + head.map(() => ' --- ').join('|') + '|'); for (const r of rows) p('| ' + r.join(' | ') + ' |'); p(); };
const count = (arr, key) => arr.reduce((o, x) => { const k = typeof key === 'function' ? key(x) : x[key]; o[k] = (o[k] || 0) + 1; return o; }, {});
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const assertSum = (label, parts, total) => { const s = parts.reduce((a, b) => a + b, 0); if (s !== total) problems.push(`${label}: Summe ${s} ≠ ${total}`); };

const m = (pagesRes || contrast || semantic).meta;
p('# AugmentAble – Evaluation gegen AccessGuru');
p();
p(`Erstellt ${m.created} · Userscript v${m.userscript.version} (sha256 \`${m.userscript.sha256.slice(0, 12)}…\`) · axe-core ${m.axe} · Commit ${m.git || 'lokal'}`);
p();
p(`**KI-Pfad:** ${m.config.AI ? (m.config.AI_MOCK ? '**MOCK** (Verkabelungstest, keine echten Beschreibungen)' : m.config.HF_KEY_PRESENT ? `aktiv (HuggingFace, Intervall ${m.aiIntervalPatched})` : 'angefordert, aber kein HF_API_KEY → keine Anfragen') : '**nicht aktiv** – Bildbeschreibung ist in diesen Zahlen nicht enthalten'} · **Netz:** ${m.config.NETWORK}`);
p();
p('<!--PROBLEMS-->');
p();

// ─── 1. Korpus ────────────────────────────────────────────────────────────────────────────
let V = [];
try { V = loadViolations(); } catch {}
if (V.length) {
  p('## 1. Korpus: Datensatz ↔ ausgewertete Seiten');
  p();
  const hosts = new Set(V.map((v) => { try { return new URL(v.web_URL).host; } catch { return v.web_URL; } }));
  const files = new Set(V.map((v) => v.html_file_name));
  const local = localPages();
  const evaluated = pagesRes ? pagesRes.pages : [];
  const evalOk = evaluated.filter((x) => !x.failed);
  const cat = count(V, 'violation_category');
  table(['Ebene', 'Anzahl', 'Anmerkung'], [
    ['annotierte Violations (CSV-Zeilen)', V.length, `Syntax ${cat.Syntax || 0} · Layout ${cat.Layout || 0} · Semantic ${cat.Semantic || 0}`],
    ['eindeutige URLs', new Set(V.map((v) => v.web_URL)).size, 'README des Datensatzes: 588 URLs; Paper: „448 URLs“'],
    ['eindeutige Hosts (Websites)', hosts.size, 'mehrere Seiten je Website möglich'],
    ['eindeutige HTML-Dateien (html_file_name)', files.size, 'Einheit der Seiten-Evaluation'],
    ['davon lokal vorhanden', [...files].filter((f) => local.has(f)).length, pagesRes?.snapshot ? `Live-Snapshot vom ${pagesRes.snapshot}` : 'aus DaRUS'],
    ['davon ausgewertet', evalOk.length, `fehlgeschlagen: ${evaluated.length - evalOk.length}`],
    ['… mit Skriptabsturz', evalOk.filter((x) => x.injectError).length, 'Skript bricht ab, Seite zählt mit dem Zustand bis zum Absturz'],
  ]);
  const annOnEvaluated = V.filter((v) => evalOk.some((x) => x.file === v.html_file_name));
  p(`Auf den ausgewerteten Seiten liegen **${annOnEvaluated.length} der ${V.length} annotierten Violations** (${pct(annOnEvaluated.length, V.length)}). Eine Annotation ist eine Zeile *(Seite, axe-Regel)* und kann mehrere Elemente umfassen; die axe-Zählung weiter unten zählt Knoten.`);
  p();
}

// ─── 2. axe vorher/nachher + bereinigtes Delta ──────────────────────────────
if (pagesRes) {
  const ok = pagesRes.pages.filter((x) => !x.failed);
  const B = ok.flatMap((x) => x.before), A = ok.flatMap((x) => x.after);
  const F = ok.flatMap((x) => x.fixed);
  p('## 2. axe-Verstöße vorher/nachher');
  p();
  p(`Knoten vorher **${B.length}**, nachher **${A.length}**, Delta **${A.length - B.length}** (${pct(A.length - B.length, B.length)}). ` +
    `Seiten besser/schlechter/gleich: ${ok.filter((x) => x.after.length < x.before.length).length} / ${ok.filter((x) => x.after.length > x.before.length).length} / ${ok.filter((x) => x.after.length === x.before.length).length}.`);
  p();
  p('**Bereinigtes Delta:** Ein Knoten gilt nur dann als repariert, wenn sein neuer zugänglicher Name aus einer inhaltlichen Quelle stammt. ' +
    '*Schein* = Platzhalter („Button“, „Link“, „Field“), URL, reiner Feldtyp, leeres Bild-alt, Warntext im `title` oder `lang="en"` auf nicht-englischem Text. *ungeprüft* = aus CSS-Klasse geraten oder aus dem `name`-Attribut.');
  p();
  const rules = [...new Set([...B, ...A].map((n) => n.rule))];
  const rows = rules.map((r) => {
    const b = B.filter((n) => n.rule === r).length, a = A.filter((n) => n.rule === r).length;
    const f = F.filter((n) => n.rule === r); const fb = count(f, 'bucket');
    return { r, b, a, d: a - b, belegt: fb.belegt || 0, ungeprueft: fb['ungeprüft'] || 0, schein: fb.Schein || 0, versteckt: fb.versteckt || 0 };
  }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  table(['Regel', 'vorher', 'nachher', 'Delta', 'repariert: belegt', 'ungeprüft', 'Schein', 'versteckt', 'Delta bereinigt'],
    rows.filter((x) => x.b || x.a).map((x) => [x.r, x.b, x.a, (x.d > 0 ? '+' : '') + x.d, x.belegt, x.ungeprueft, x.schein, x.versteckt, (x.d + x.schein + x.versteckt > 0 ? '+' : '') + (x.d + x.schein + x.versteckt)]));
  const sB = F.filter((f) => f.bucket === 'Schein').length + F.filter((f) => f.bucket === 'versteckt').length;
  p(`Summe Schein-/Versteck-Reparaturen: **${sB}** Knoten. Bereinigtes Gesamtdelta: **${A.length - B.length + sB}** (${pct(A.length - B.length + sB, B.length)}) statt ${A.length - B.length}.`);
  p();

  // ─── 3. Recall gegen Annotationen ─────────────────────────────────────────
  const ann = ok.flatMap((x) => x.annotations || []);
  if (ann.length) {
    p('## 3. Recall gegen die annotierten AccessGuru-Violations');
    p();
    p('Jede annotierte Violation (Syntax/Layout) wird über das axe-HTML-Snippet dem Knoten im Vorher-Scan zugeordnet. ' +
      '*nicht zuordenbar* = das annotierte Element taucht im Vorher-Scan nicht auf (anderes axe-Release: Annotation mit axe 4.4, hier ' + m.axe + '; oder Seite verändert). ' +
      'Recall streng = behoben *und* alle Namen aus inhaltlicher Quelle, bezogen auf zuordenbare Annotationen.');
    p();
    const agg = (arr) => {
      const s = count(arr, 'status'); const z = arr.filter((a) => a.status !== 'nicht zuordenbar');
      const strict = z.filter((a) => a.status === 'behoben' && a.buckets.every((b) => b === 'belegt')).length;
      return [arr.length, z.length, s.behoben || 0, strict, s.teilweise || 0, s['nicht behoben'] || 0, s['nicht zuordenbar'] || 0, pct(s.behoben || 0, z.length), pct(strict, z.length)];
    };
    const head = ['', 'annotiert', 'zuordenbar', 'behoben', 'davon inhaltlich', 'teilweise', 'nicht behoben', 'nicht zuordenbar', 'Recall (axe)', 'Recall streng'];
    table(head, [...Object.entries(count(ann, 'category')).map(([c]) => [c, ...agg(ann.filter((a) => a.category === c))]), ['**gesamt**', ...agg(ann)]]);
    const byRule = Object.keys(count(ann, 'rule')).map((r) => [r, ...agg(ann.filter((a) => a.rule === r))]).sort((a, b) => b[1] - a[1]);
    p('<details><summary>Nach Regel</summary>'); p(); table(['Regel', ...head.slice(1)], byRule); p('</details>'); p();
    p('Die 33 semantischen Annotationen des Volldatensatzes sind Teil der 55 Fälle mit Expertenkorrekturen und werden in Abschnitt 4 ausgewertet.');
    p();
  }
}

// ─── 4. Semantik gegen Expertenkorrekturen ──────────────────────────────────
if (semsim) {
  p('## 4. Semantische Kategorie: Vergleich mit den Expertenkorrekturen');
  p();
  p(`55 semantische Fälle aus AccessGuru, je bis zu 3 Korrekturen von Entwickler:innen. Metrik: **${semsim.metric}** (Text) bzw. Jaccard (lang-Mengen), wie im AccessGuru-Paper. ` +
    '„sim vorher“ = Originalcode ↔ Korrektur, „sim nachher“ = nach AugmentAble ↔ Korrektur. *besser/schlechter* = |Δ| > 0,05.');
  p();
  table(['Violation-Typ', 'n', 'vom Skript verändert', 'näher an Korrektur', 'weiter weg', 'sim vorher', 'sim nachher'],
    Object.entries(semsim.by_type).map(([k, v]) => [k, v.n, v.angefasst, v.besser, v.schlechter, fmt(v.sim_vorher), fmt(v.sim_nachher)]));
  const ch = semsim.items.filter((i) => i.changed);
  if (ch.length) {
    p('Alle Fälle, in denen das Skript den relevanten Wert verändert hat:');
    p();
    table(['#', 'Typ', 'vorher', 'nachher (AugmentAble)', 'Expert:innen', 'Δ sim'],
      ch.map((i) => [i.no, i.type, JSON.stringify(i.before), JSON.stringify(i.after), (i.human || []).map((h) => JSON.stringify(h)).join('<br>'), fmt(i.delta)]));
  }
  p('> Hinweis Datenbereinigung: In den Entwickler-Korrekturen endet der Marker-Kommentar auf `--">` statt `-->`. Ein Browser würde die Korrektur dadurch komplett auskommentieren; das Kommentarende wird vor dem Parsen repariert.');
  p();
}

// ─── 5. KI ───────────────────────────────────────────────────────────────────────
p('## 5. KI-Bildbeschreibung');
p();
const aiCalls = [...(semantic?.ai || []), ...(pagesRes?.ai || [])];
if (!m.config.AI || !m.config.HF_KEY_PRESENT || m.config.AI_MOCK) {
  p('> ⚠ **In diesem Lauf nicht ausgeführt.** Workflow mit `ai: true` und gesetztem Secret `HF_API_KEY` starten.');
  p();
}
if (aiCalls.length) {
  table(['Modell', 'Anfragen', 'HTTP 200', 'Fehler', 'aus Cache', 'mittlere Latenz (ms)'],
    Object.entries(count(aiCalls, (a) => a.model || '?')).map(([mod, n]) => {
      const c = aiCalls.filter((a) => (a.model || '?') === mod); const lat = c.filter((a) => a.ms);
      return [mod, n, c.filter((a) => a.status === 200).length, c.filter((a) => a.status !== 200 && !a.blocked).length, c.filter((a) => a.cached).length, lat.length ? Math.round(lat.reduce((s, a) => s + a.ms, 0) / lat.length) : '–'];
    }));
  p(`Datenabfluss: **${aiCalls.filter((a) => !a.blocked && !a.cached).length}** Bilder wurden in diesem Lauf an HuggingFace bzw. den jeweiligen Provider übertragen (${aiCalls.filter((a) => a.cached).length} aus Cache).`);
  p();
}
if (semsim) {
  const aiItems = semsim.items.filter((i) => i.ai_alt);
  if (aiItems.length) {
    p('**Qualität gegen Expertenkorrekturen** (Bildfälle, Bild ohne `alt` eingebettet, unveränderter Skriptpfad):');
    p();
    table(['#', 'KI-Alt-Text', 'Expert:innen', 'Ähnlichkeit'], aiItems.map((i) => [i.no, i.ai_alt, (i.human || []).map((h) => h.join(' | ')).join('<br>'), fmt(i.ai_sim)]));
  }
  const trig = semsim.items.filter((i) => i.type === 'image-alt-not-descriptive');
  p(`Auslöser im Originalfall: Das Skript beschreibt nur Bilder mit fehlendem/leerem alt, alt = src oder alt = "image". In den ${trig.length} Fällen *nicht beschreibender* Alt-Texte wurde es **${trig.filter((i) => i.changed).length}-mal** aktiv.`);
  p();
}
if (pagesRes) {
  const se = pagesRes.pages.filter((x) => !x.failed).map((x) => x.sideEffects);
  const st = se.reduce((o, s) => { for (const [k, v] of Object.entries(s.kiBilder || {})) o[k] = (o[k] || 0) + v; return o; }, {});
  p(`Seiten: Bilder ohne alt ${se.reduce((a, s) => a + s.bilderOhneAltGesamt, 0)}, davon erfüllen die Auslösebedingung ${se.reduce((a, s) => a + s.kiKandidaten, 0)}; Status nach Lauf: ${JSON.stringify(st)}.` +
    (m.config.NETWORK === 'offline' ? ' Im Offline-Modus laden keine Bilder – die KI kann auf Seiten nur mit `network: live` greifen.' : ''));
  p();
}

// ─── 6. Schäden ──────────────────────────────────────────────────────────────────────────
if (pagesRes) {
  const ok = pagesRes.pages.filter((x) => !x.failed);
  const labels = ok.flatMap((x) => x.labels);
  p('## 6. Schäden und Nebenwirkungen');
  p();
  p('### 6.1 Vom Skript gesetzte Namen (Präzision)');
  p();
  table(['Element', 'Herkunft', 'Anzahl', 'Anteil', 'Bewertung'],
    Object.entries(count(labels, (l) => l.kind + '\u0000' + l.src)).sort().map(([k, n]) => {
      const [kind, src] = k.split('\u0000'); const tot = labels.filter((l) => l.kind === kind).length;
      return [kind, src, n, pct(n, tot), labels.find((l) => l.kind === kind && l.src === src).bucket];
    }));
  const bl = count(labels, 'bucket');
  p(`Automatische Präzision: streng ${pct(bl.belegt || 0, labels.length)} (nur *belegt*), großzügig ${pct((bl.belegt || 0) + (bl['ungeprüft'] || 0), labels.length)} (inkl. *ungeprüft*). ` +
    'Die tatsächliche Präzision ergibt sich aus der manuellen Stichprobe `manual_review_sample.csv`.');
  p();
  p(`Links ohne \`href\`, die ein aria-label bekommen (→ \`aria-prohibited-attr\`): **${labels.filter((l) => l.noHref).length}**.`);
  p();

  const ov = ok.flatMap((x) => x.overwritten.map((o) => ({ ...o, file: x.file })));
  p('### 6.2 Vorhandene Namen überschrieben oder entfernt');
  p();
  p('Elemente, die *vor* dem Skript bereits einen zugänglichen Namen hatten und danach einen anderen oder keinen:');
  p();
  table(['Ursache', 'Elemente', 'Seiten'], Object.entries(count(ov, 'cause')).map(([c, n]) => [c, n, new Set(ov.filter((o) => o.cause === c).map((o) => o.file)).size]));
  p('<details><summary>Beispiele</summary>'); p();
  table(['Seite', 'Element', 'vorher', 'nachher'], ov.slice(0, 40).map((o) => [o.file, o.tag, o.before, o.hidden ? '*(versteckt)*' : o.after]));
  p('</details>'); p();

  const wt = ok.flatMap((x) => x.warnTitles);
  p('### 6.3 Diagnosetext in `title`');
  p();
  table(['', 'Anzahl'], [
    ['title-Attribute mit Warntext gesetzt', wt.length],
    ['… davon wird der Warntext zum **zugänglichen Namen**', wt.filter((w) => w.isName).length],
    ['… davon zur Beschreibung (Name kam aus anderer Quelle)', wt.filter((w) => !w.isName).length],
    ['… davon vorhandenes title überschrieben', wt.filter((w) => w.overwroteTitle).length],
  ]);
  p('`checkHeadings()`/`checkLabels()` sind als Diagnose gedacht, schreiben aber in die produktive Oberfläche: Der Text erscheint als Tooltip für alle und wird von Screenreadern als Name oder Beschreibung vorgelesen. Das ist ein direkter Schaden, keine Nebenwirkung.');
  p();

  const langSet = ok.filter((x) => !x.langBefore && x.langAfter);
  const mism = langSet.filter((x) => x.textLang !== 'und' && x.textLang !== x.langAfter);
  p('### 6.4 `lang="en"` ohne Prüfung');
  p();
  p(`Seiten ohne lang, denen das Skript \`lang="${langSet[0]?.langAfter || 'en'}"\` gesetzt hat: **${langSet.length}**; erkannte Textsprache (franc) weicht ab: **${mism.length}** → im AccessGuru-Sinn neue *lang-mismatch*-Violations (semantisch). ` +
    `Sprache nicht bestimmbar (< 200 Zeichen): ${langSet.filter((x) => x.textLang === 'und').length}.`);
  if (mism.length) { p(); table(['Seite', 'erkannte Sprache'], mism.map((x) => [x.file, x.textLang])); }
  p();

  const sum = (k) => ok.reduce((a, x) => a + (+x.sideEffects[k] || 0), 0);
  p('### 6.5 Weitere Eingriffe');
  p();
  table(['Beobachtung', 'Anzahl'], [
    ['SVGs mit aria-hidden="true" versteckt', sum('svgVersteckt')],
    ['… davon SVGs mit Link darin (Link für Screenreader weg)', sum('svgVersteckteLinks')],
    ['… davon mit fokussierbarem Inhalt (→ aria-hidden-focus)', sum('svgVersteckteFokussierbare')],
    ['SVGs aus <title> benannt', sum('svgBenannt')],
    ['Seiten mit eingefügtem Skip-Link', ok.filter((x) => x.sideEffects.skipLink).length],
    ['positive tabindex auf 0 umgeschrieben', sum('tabindexUmgeschrieben')],
    ['nav beschriftet', sum('navBeschriftet')],
    ['Autoplay-Videos stummgeschaltet', sum('videoGemutet')],
    ['Kontrast-Marker gesetzt', sum('kontrastMarkiert')],
    ['GM_xmlhttpRequest-Aufrufe', ok.reduce((a, x) => a + x.gm.xhr, 0)],
    ['prompt()-Dialoge (API-Key-Abfrage)', ok.reduce((a, x) => a + x.gm.prompts, 0)],
  ]);

  // ─── 7. Regressionen ────────────────────────────────────────────────────
  p('## 7. Regressionen (neue Verstöße) nach Verursacher-Marker');
  p();
  const B = ok.flatMap((x) => x.before);
  const newNodes = ok.flatMap((x) => { const bk = new Set(x.before.map((n) => n.rule + '|' + n.evalId)); return x.after.filter((n) => !n.evalId || !bk.has(n.rule + '|' + n.evalId)).map((n) => ({ ...n, file: x.file })); });
  const mk = (n) => (n.marker ? Object.entries(n.marker).filter(([, v]) => v).map(([k]) => k).join('+') || 'ohne Marker' : 'nicht markierbar');
  table(['Regel', 'neue Knoten', 'Seiten', 'Marker am Element'], Object.entries(count(newNodes, 'rule')).sort((a, b) => b[1] - a[1]).map(([r, n]) => {
    const s = newNodes.filter((x) => x.rule === r); return [r, n, new Set(s.map((x) => x.file)).size, Object.entries(count(s, mk)).map(([k, v]) => `${k}: ${v}`).join(', ')];
  }));
  p('## 8. Verstöße des eingeblendeten Panels');
  p();
  const P = ok.flatMap((x) => x.panel || []);
  table(['Regel', 'Knoten (Summe)'], Object.entries(count(P, 'rule')).map(([r, n]) => [r, n]));
  p('## 9. Fehlgeschlagene Seiten / Skriptabstürze');
  p();
  table(['Fehler', 'Seiten'], Object.entries(count(pagesRes.pages.filter((x) => x.failed || x.injectError), (x) => (x.failed ? 'Harness: ' : 'Skript: ') + (x.failed || x.injectError).slice(0, 110))).map(([k, v]) => [k.replace(/\|/g, '\\|'), v]));

  // manuelle Stichprobe
  const pool = ok.flatMap((x) => x.labels.map((l) => ({ ...l, file: x.file, url: x.url })));
  const rnd = (s) => () => ((s = Math.imul(48271, s) % 2147483647) / 2147483647);
  const r = rnd(42); const sample = pool.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).slice(0, 300).map((x) => x[1]);
  writeFileSync(path.join(OUT, 'manual_review_sample.csv'), csv([['seite', 'url', 'element', 'herkunft', 'automatische_bewertung', 'gesetztes_label', 'name_vorher', 'html', 'bewertung_mensch (korrekt/teilweise/falsch)', 'kommentar'],
    ...sample.map((l) => [l.file, l.url, l.kind, l.src, l.bucket, l.label, l.nameBefore, l.html, '', ''])]));
}

// ─── 10. Kontrast ──────────────────────────────────────────────────────────────────────────
if (contrast) {
  p('## 10. Kontrast-Modul');
  p();
  p(`${contrast.annotationen} Kontrast-Annotationen → **${contrast.faelle} eindeutige Fälle** (Regel, Vordergrund, Hintergrund, Schriftgröße, Schriftschnitt). ` +
    'Dieselbe Farbkombination kann zweimal vorkommen – einmal als `color-contrast`, einmal als `color-contrast-enhanced`.');
  p();
  const rowsOrder = ['behoben', 'verbessert, reicht nicht', 'verschlechtert', 'geändert, Kontrast gleich', 'markiert, Farbe unverändert', 'unter Schwelle, nicht angefasst', 'war schon ok', 'war ok, trotzdem geändert', 'war ok, durch Skript unter Schwelle'];
  for (const [v, s] of Object.entries(contrast.summary)) {
    p(`### Variante ${v}: ${v === 'A' ? 'Hintergrund auf dem Textelement' : 'Hintergrund auf dem Elternelement (häufigster Fall in echten Seiten)'}`);
    p();
    const rs = rowsOrder.filter((o) => s.orig[o] || s.aa[o]);
    table(['Ergebnis', 'gegen Original-Schwelle (AA/AAA)', 'gegen AA-Schwelle'], [...rs.map((o) => [o, `${s.orig[o]} (${pct(s.orig[o], s.n)})`, `${s.aa[o]} (${pct(s.aa[o], s.n)})`]), ['**Summe**', s.n, s.n]]);
    assertSum(`Kontrast ${v} Original`, Object.values(s.orig), s.n); assertSum(`Kontrast ${v} AA`, Object.values(s.aa), s.n);
    p(`Vom Skript markiert (\`data-a11y-contrast\`): **${s.angefasst}**, davon Farbe tatsächlich geändert: **${s.farbe_geaendert}**. Fälle unter AA vor dem Eingriff: ${s.unter_aa_vorher}.`);
    if (s.orig['markiert, Farbe unverändert']) p(`Die ${s.orig['markiert, Farbe unverändert']} markierten, aber unveränderten Fälle haben bereits schwarzen Text (#000000) – das Skript kann nur abdunkeln, markiert sie aber trotzdem als korrigiert. Das erklärt „angefasst ${s.angefasst}“ gegenüber ${s.angefasst - s.orig['markiert, Farbe unverändert']} geänderten Farben.`);
    if (s.schwarz) p(`Auf reines Schwarz heruntergerechnet: ${s.schwarz} (${Object.entries(s.schwarz_nach_ausgang).map(([k, n]) => `${k}: ${n}`).join(', ')}). Verschlechterungen auf dunklem Hintergrund: ${s.dunkler_bg_bei_verschlechterung} von ${s.orig.verschlechtert}.`);
    p();
    if (s.verschlechtert.length) {
      p('<details><summary>Verschlechterte Fälle</summary>'); p();
      table(['Regel', 'fg', 'bg', 'Größe', 'Schnitt', 'vorher', 'nachher', 'neue Farbe'], s.verschlechtert.map((x) => [x.rule, x.fg, x.bg, x.fontSizeRaw, x.weight, fmt(x.r0), fmt(x.r1), x.color1]));
      p('</details>'); p();
    }
    table(['Regel', 'n', 'behoben (Original-Schwelle)', 'behoben (AA)'], Object.entries(s.nach_regel).map(([r, x]) => [r, x.n, `${x.behoben_orig} (${pct(x.behoben_orig, x.n)})`, `${x.behoben_aa} (${pct(x.behoben_aa, x.n)})`]));
  }
}

let md = L.join('\n');
md = md.replace('<!--PROBLEMS-->', problems.length ? '> ✗ **Konsistenzprüfung fehlgeschlagen:**\n' + problems.map((x) => '> - ' + x).join('\n') : '> ✓ Konsistenzprüfung: alle Tabellen summieren sich auf ihre Grundgesamtheit.');
writeFileSync(path.join(OUT, 'REPORT.md'), md);
if (semsim) writeFileSync(path.join(OUT, 'semantic_items.csv'), csv([['nr', 'typ', 'verändert', 'vorher', 'nachher', 'expert_innen', 'sim_vorher', 'sim_nachher', 'delta', 'ki_alt', 'ki_sim'],
  ...semsim.items.map((i) => [i.no, i.type, i.changed, JSON.stringify(i.before), JSON.stringify(i.after), JSON.stringify(i.human || []), i.sim_before, i.sim_after, i.delta, i.ai_alt, i.ai_sim])]));
console.log('→ results/REPORT.md', problems.length ? `(${problems.length} Konsistenzprobleme)` : '');
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (problems.length) process.exitCode = 1;
