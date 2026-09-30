// Vergleich v140 (original) ↔ v141 (fixed) aus results/<version>/summary.json → results/COMPARE.md
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../harness/core.mjs';

const load = (v) => { const f = path.join(ROOT, 'results', v, 'summary.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const a = load('original'), b = load('fixed');
if (!a || !b) { console.error('✗ summary.json für beide Versionen nötig (SCRIPT=original bzw. fixed, dann npm run report)'); process.exit(1); }
const tests = existsSync(path.join(ROOT, 'results', 'tests.json')) ? JSON.parse(readFileSync(path.join(ROOT, 'results', 'tests.json'), 'utf8')) : null;
const pc = (x) => (x == null ? '–' : (100 * x).toFixed(1) + ' %');
const v = (x) => (x == null ? '–' : x);
const rows = [
  ['Betreuer-Punkt', 'Kennzahl', 'v140', 'v141', 'besser ist'],
  ...(tests ? [['alle', 'Testfälle je Kritikpunkt bestanden', `${tests.filter((t) => t.original.pass).length}/${tests.length}`, `${tests.filter((t) => t.fixed.pass).length}/${tests.length}`, 'mehr']] : []),
  ['1 KI', 'VizWiz: Ähnlichkeit KI ↔ Menschen (Obergrenze Mensch↔Mensch)', `${v(a.viz_sim)} (${v(a.viz_ceiling)})`, `${v(b.viz_sim)} (${v(b.viz_ceiling)})`, 'höher'],
  ['1 KI', 'VizWiz: deutsche Seite → deutscher Alt-Text', v(a.viz_deutsch), v(b.viz_deutsch), 'mehr'],
  ['1 KI', 'VizWiz: beschrieben', v(a.viz_beschrieben), v(b.viz_beschrieben), 'mehr'],
  ['2 Kontrast', 'Variante A: behoben (AA) / verschlechtert', `${a.kontrast_A?.behoben_aa} / ${a.kontrast_A?.verschlechtert}`, `${b.kontrast_A?.behoben_aa} / ${b.kontrast_A?.verschlechtert}`, 'mehr / weniger'],
  ['2 Kontrast', 'Variante B (Hintergrund am Elternelement): behoben (AA)', a.kontrast_B?.behoben_aa, b.kontrast_B?.behoben_aa, 'mehr'],
  ['3 AccessGuru', 'Recall annotierte Violations (axe)', pc(a.recall), pc(b.recall), 'höher'],
  ['3 AccessGuru', 'Recall streng (nur inhaltlich belegte Namen)', pc(a.recall_streng), pc(b.recall_streng), 'höher'],
  ['3 AccessGuru', 'Semantik: vom Skript veränderte Fälle / näher an Experten / weiter weg', `${v(a.sem_veraendert)} / ${v(a.sem_naeher)} / ${v(a.sem_weiter)}`, `${v(b.sem_veraendert)} / ${v(b.sem_naeher)} / ${v(b.sem_weiter)}`, 'weiter weg = 0'],
  ['3 AccessGuru', 'Präzision gesetzter Labels (streng / großzügig)', `${pc(a.praezision_streng)} / ${pc(a.praezision_grosszuegig)}`, `${pc(b.praezision_streng)} / ${pc(b.praezision_grosszuegig)}`, 'höher'],
  ['4 Schaden', 'title-Attribute mit Warntext (davon als Name vorgelesen)', `${v(a.warntext_title)} (${v(a.warntext_als_name)})`, `${v(b.warntext_title)} (${v(b.warntext_als_name)})`, '0'],
  ['4 Schaden', 'vorhandene Namen überschrieben/entfernt', v(a.namen_ueberschrieben), v(b.namen_ueberschrieben), '0'],
  ['4 Schaden', 'lang gesetzt / davon falsche Sprache', `${v(a.lang_gesetzt)} / ${v(a.lang_falsch)}`, `${v(b.lang_gesetzt)} / ${v(b.lang_falsch)}`, 'falsch = 0'],
  ['4 Schaden', 'Links in SVG für Screenreader versteckt', v(a.svg_links_versteckt), v(b.svg_links_versteckt), '0'],
  ['4 Schaden', 'aria-label auf <a> ohne href', v(a.anker_ohne_href), v(b.anker_ohne_href), '0'],
  ['–', 'axe-Knoten: Delta / bereinigtes Delta', `${v(a.axe_delta)} / ${v(a.axe_delta_bereinigt)}`, `${v(b.axe_delta)} / ${v(b.axe_delta_bereinigt)}`, 'negativer'],
  ['–', 'neue axe-Verstöße durch das Skript', v(a.neue_verstoesse), v(b.neue_verstoesse), 'weniger'],
  ['–', 'Verstöße des Panels selbst', v(a.panel_verstoesse), v(b.panel_verstoesse), '0'],
  ['–', 'Seiten mit Skriptabsturz', v(a.abstuerze), v(b.abstuerze), '0'],
];
const md = ['# Vergleich v140 ↔ v141', '', `Seiten: ${v(a.seiten)} · KI: ${a.meta.config.AI ? 'an' : 'aus'} · Netz: ${a.meta.config.NETWORK}`, '',
  '| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(() => ' --- ').join('|') + '|', ...rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |'), ''].join('\n');
writeFileSync(path.join(ROOT, 'results', 'COMPARE.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + md + '\n');
console.log(md);
