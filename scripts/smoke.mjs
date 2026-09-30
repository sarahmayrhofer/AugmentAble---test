// Schneller Selbsttest der Testumgebung (läuft bei jedem Push):
//   1. Testfälle je Kritikpunkt für v140 und v141 (tests/cases.mjs)
//   2. Kontrast + Semantik auf AccessGuru-Daten, Seiten-Evaluation auf tests/fixtures – für beide Versionen
//   3. KI-Verkabelung mit Mock-Antwort
// Kennzahlen werden gegen tests/expected.json geprüft (dort je Version festgeschrieben).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const expected = json('tests/expected.json');
const fails = [];
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ' (erwartet ' + JSON.stringify(want) + ')'}`); if (!ok) fails.push(label); };

// 1. Testfälle (v141 muss alle bestehen)
try { run('node scripts/test-cases.mjs'); } catch { fails.push('Testfälle v141'); }

for (const script of ['original', 'fixed']) {
  const env = { SCRIPT: script };
  const exp = expected[script];
  const dir = `results/${script}`;
  console.log(`\n══════ ${script} ══════`);
  // KI-Verkabelung (Mock) – Ergebnis wird danach überschrieben
  run('node scripts/eval-semantic.mjs', { ...env, AI: '1', AI_MOCK: '1' });
  const mock = json(`${dir}/semantic.json`).items.filter((i) => i.ai);
  eq(`${script}: KI-Mock setzt alt`, mock.filter((i) => i.ai.alt === 'MOCK description of the image').length, mock.length);

  run('node scripts/eval-contrast.mjs', env);
  run('node scripts/eval-semantic.mjs', env);
  run('python3 scripts/similarity.py', env);
  run('node scripts/eval-pages.mjs', { ...env, PAGES_DIR: 'tests/fixtures' });
  run('node scripts/report.mjs', env);

  const c = json(`${dir}/contrast.json`);
  eq(`${script}: Kontrast eindeutige Fälle`, c.faelle, 553);
  eq(`${script}: Kontrast A (Original-Schwelle)`, c.summary.A.orig, exp.contrast_A_orig);
  eq(`${script}: Kontrast A markiert`, c.summary.A.angefasst, exp.contrast_A_markiert);
  eq(`${script}: Kontrast B markiert`, c.summary.B.angefasst, exp.contrast_B_markiert);
  const s = json(`${dir}/semantic.json`);
  eq(`${script}: Semantik veränderte Fälle je Typ`, Object.fromEntries(Object.entries(s.byType).map(([k, v]) => [k, v.angefasst])), exp.semantic_changed);
  const p = json(`${dir}/pages.json`);
  const crash = p.pages.find((x) => x.file === 'crash-newline-id.html');
  eq(`${script}: Absturz bei id mit Zeilenumbruch`, /querySelector/.test(crash.injectError || ''), exp.crash);
  const ks = p.pages.find((x) => x.file === 'kitchen-sink.html');
  eq(`${script}: überschriebene Namen`, ks.overwritten.map((o) => o.cause).sort(), exp.fixture_overwritten);
  eq(`${script}: lang auf deutscher Seite`, ks.langAfter, exp.fixture_lang);
}
run('node scripts/compare.mjs');

if (fails.length) { console.error(`\n${fails.length} Prüfung(en) fehlgeschlagen: ${fails.join('; ')}`); process.exit(1); }
console.log('\nSmoke-Test bestanden.');
