// Schneller Selbsttest der Testumgebung (läuft bei jedem Push):
//   Kontrast + Semantik auf AccessGuru-Daten, Seiten-Evaluation auf tests/fixtures,
//   KI-Verkabelung mit Mock. Prüft Kennzahlen gegen tests/expected.json.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const expected = json('tests/expected.json');
const fails = [];
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ' (erwartet ' + JSON.stringify(want) + ')'}`); if (!ok) fails.push(label); };

// 1. KI-Verkabelung (Mock) – vor den echten Läufen, Ergebnis wird danach überschrieben
run('node scripts/eval-semantic.mjs', { AI: '1', AI_MOCK: '1' });
const mock = json('results/semantic.json').items.filter((i) => i.ai);
eq('KI-Mock: Bildfälle mit gesetztem alt', mock.filter((i) => i.ai.alt === 'MOCK description of the image').length, mock.length);

// 2. Echte Läufe
run('node scripts/eval-contrast.mjs');
run('node scripts/eval-semantic.mjs');
run('python3 scripts/similarity.py');
run('node scripts/eval-pages.mjs', { PAGES_DIR: 'tests/fixtures' });
run('node scripts/report.mjs');

const c = json('results/contrast.json');
eq('Kontrast: eindeutige Fälle', c.faelle, expected.contrast.faelle);
eq('Kontrast A (Original-Schwelle)', c.summary.A.orig, expected.contrast.A_orig);
eq('Kontrast A markiert', c.summary.A.angefasst, expected.contrast.A_angefasst);
eq('Kontrast B markiert', c.summary.B.angefasst, 0);
const s = json('results/semantic.json');
eq('Semantik: veränderte Fälle je Typ', Object.fromEntries(Object.entries(s.byType).map(([k, v]) => [k, v.angefasst])), expected.semantic_changed);
const p = json('results/pages.json');
const crash = p.pages.find((x) => x.file === 'crash-newline-id.html');
eq('Fixture: Absturz bei id mit Zeilenumbruch', /querySelector/.test(crash.injectError || ''), true);
const ks = p.pages.find((x) => x.file === 'kitchen-sink.html');
eq('Fixture: überschriebene Namen', ks.overwritten.map((o) => o.cause).sort(), expected.fixture_overwritten);
eq('Fixture: lang-mismatch erkannt', [ks.langAfter, ks.textLang], ['en', 'de']);

if (fails.length) { console.error(`\n${fails.length} Prüfung(en) fehlgeschlagen`); process.exit(1); }
console.log('\nSmoke-Test bestanden.');
