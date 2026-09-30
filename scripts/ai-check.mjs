// KI-Check: Funktioniert die Bildbeschreibung mit echtem HuggingFace-Aufruf?
//
// Teil 1 – Skriptpfad: Für jedes Modell der Fallback-Kette werden 3 Bilder über den unveränderten
//   Skriptpfad (processNextImage → Canvas → GM_xmlhttpRequest) beschrieben. Damit jedes Modell
//   einzeln geprüft wird, stellt die Harness das jeweilige Modell an den Anfang der MODELS-Liste.
//   Fehlermeldungen der API werden mitprotokolliert.
// Teil 2 – Diagnose (direkt, ohne Skript):
//   a) jedes Skript-Modell einmal mit Bild als öffentliche URL statt Data-URL (mit und ohne Provider-Suffix)
//   b) welche Bild-Modelle der HuggingFace-Router aktuell anbietet (/v1/models), und die ersten
//      AI_CHECK_EXTRA davon (Standard 6) mit einem Testbild → Kandidaten für eine neue Modellliste
//
//   HF_API_KEY=hf_… npm run ai-check            (SCRIPT=fixed|original, Standard fixed)
process.env.AI = '1';
process.env.AI_NO_CACHE = '1';
import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launch, openPage, injectAugmentAble, loadScript, SCRIPT, OUT, aiLog } from '../harness/core.mjs';
import { AG } from '../harness/dataset.mjs';

if (!process.env.HF_API_KEY) {
  console.error('✗ HF_API_KEY fehlt. In GitHub: Settings → Secrets and variables → Actions → New repository secret "HF_API_KEY".');
  process.exit(1);
}
const KEY = process.env.HF_API_KEY;
const API = 'https://router.huggingface.co/v1';

const script = loadScript(SCRIPT);
const models = [...script.raw.matchAll(/'([^']+:[a-z-]+)'/g)].map((m) => m[1]).filter((m) => m.includes('/'));
const supp = path.join(AG, 'data', 'accessguru_dataset', 'accessguru_semantic_violations_sampled_dataset_supp_material');
const IMAGES = [
  { file: '1.png', note: 'Logo (W3C)' },
  { file: '50.png', note: 'Diagramm (Klimadaten)' },
  { file: '52.png', note: 'Webseiten-Ausschnitt' },
].filter((i) => existsSync(path.join(supp, i.file)));
if (!IMAGES.length) { console.error('✗ Testbilder fehlen – zuerst "npm run fetch" (SKIP_DARUS=1 genügt).'); process.exit(1); }
const PUBLIC_IMG = 'https://raw.githubusercontent.com/NadeenAhmad/AccessGuruLLM/bf45666aa281af7cca23aaabd9bfe3bd802b9036/data/accessguru_dataset/accessguru_semantic_violations_sampled_dataset_supp_material/1.png';
const short = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 220);

// ─── Teil 1: Skriptpfad ─────────────────────────────────────────────────────
const html = `<!doctype html><html lang="en"><head><title>KI-Check</title></head><body><main><h1>Image check</h1>${IMAGES.map((i, k) => `<figure><img id="i${k}" src="https://ki-check.test/${i.file}" style="width:480px;height:auto"><figcaption>${i.note}</figcaption></figure>`).join('')}</main></body></html>`;
const routes = Object.fromEntries(IMAGES.map((i) => [i.file, path.join(supp, i.file)]));

const browser = await launch();
const rows = [];
for (const model of models) {
  const order = [model, ...models.filter((m) => m !== model)];
  const raw = script.raw.replace(/const MODELS\s*=\s*\[[\s\S]*?\];/, `const MODELS = [${order.map((m) => `'${m}'`).join(', ')}];`);
  const pageId = 'ki-check-' + model;
  const { page, context } = await openPage(browser, { pageId, baseUrl: 'https://ki-check.test/', html, extraRoutes: routes, ai: true });
  await injectAugmentAble(page, { raw, ai: true });
  const res = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll('main img')].map((i) => ({ alt: i.getAttribute('alt'), state: i.getAttribute('data-ai-done'), model: i.getAttribute('data-ai-model') })),
  }));
  await context.close();
  const calls = aiLog.filter((a) => a.page === pageId);
  const own = calls.filter((c) => c.model === model);
  const ok = own.filter((c) => c.status === 200);
  rows.push({ model, anfragen: own.length, ok: ok.length, status: [...new Set(own.map((c) => c.status))].join(','),
    ms: ok.length ? Math.round(ok.reduce((s, c) => s + (c.ms || 0), 0) / ok.length) : null,
    fehler: short((own.find((c) => c.error) || {}).error),
    alts: res.imgs.map((i, k) => ({ bild: IMAGES[k].note, alt: i.alt, state: i.state, von: i.model })) });
  const r = rows.at(-1);
  console.log(`${r.ok ? '✓' : '✗'} ${model}: ${r.ok}/${r.anfragen} erfolgreich, HTTP ${r.status || '–'}, Ø ${r.ms ?? '–'} ms`);
  if (r.fehler) console.log(`    Fehler: ${r.fehler}`);
  for (const a of r.alts) console.log(`    ${a.bild}: ${a.alt ? JSON.stringify(a.alt) : '(' + a.state + ')'}`);
}
await browser.close();

// ─── Teil 2: Diagnose direkt gegen die API ─────────────────────────────────────
async function describe(model, url) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${API}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 80, messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url } }, { type: 'text', text: 'Write alt text for this image in one short sentence.' }] }] }),
    });
    const t = await r.text();
    let text = null; try { text = JSON.parse(t).choices[0].message.content.trim(); } catch {}
    return { status: r.status, ms: Date.now() - t0, text, error: r.status === 200 ? null : short(t) };
  } catch (e) { return { status: 0, ms: Date.now() - t0, text: null, error: short(e) }; }
}

// a) Skript-Modelle mit öffentlicher Bild-URL, zusätzlich ohne Provider-Suffix (Router wählt selbst)
const direct = [];
const directIds = [...models, ...new Set(models.map((m) => m.split(':')[0]))];
for (const m of directIds) { const d = await describe(m, PUBLIC_IMG); direct.push({ model: m, ...d }); console.log(`URL-Test ${m}: HTTP ${d.status} ${d.text ? JSON.stringify(d.text) : d.error}`); }

// b) verfügbare Bild-Modelle
let available = [], modelsError = null;
try {
  const r = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  available = (j.data || []).filter((m) => {
    const mod = (m.architecture && (m.architecture.input_modalities || m.architecture.modality)) || [];
    return JSON.stringify(mod).includes('image');
  }).map((m) => ({ id: m.id, providers: (m.providers || []).filter((p) => !p.status || p.status === 'live').map((p) => p.provider) }));
} catch (e) { modelsError = short(e); }
// Falls der Router keine Modalitäten liefert: bekannte Bild-Modelle als Kandidaten
const FALLBACK = ['Qwen/Qwen2.5-VL-72B-Instruct', 'Qwen/Qwen2.5-VL-32B-Instruct', 'Qwen/Qwen3-VL-8B-Instruct', 'google/gemma-3-27b-it', 'meta-llama/Llama-4-Scout-17B-16E-Instruct', 'zai-org/GLM-4.5V'];
if (!available.length) available = FALLBACK.map((id) => ({ id, providers: ['(auto)'] }));
console.log(`\nVerfügbare Bild-Modelle laut Router: ${available.length}${modelsError ? ' (Fehler: ' + modelsError + ')' : ''}`);
const N_EXTRA = +(process.env.AI_CHECK_EXTRA || 6);
const extra = [];
for (const m of available.slice(0, N_EXTRA)) {
  const d = await describe(m.id, PUBLIC_IMG);
  extra.push({ model: m.id, providers: m.providers, ...d });
  console.log(`Kandidat ${m.id} [${m.providers.join(', ')}]: HTTP ${d.status} ${d.text ? JSON.stringify(d.text) : d.error}`);
}

// ─── Ausgabe ───────────────────────────────────────────────────────────────────────
const esc = (s) => String(s || '').replace(/\|/g, '/');
const md = ['## KI-Check (echte HuggingFace-Aufrufe)', '', `Skript: ${SCRIPT} v${script.version}`, '',
  '### 1. Über den Skriptpfad (Canvas → Data-URL)', '',
  '| Modell | erfolgreich | HTTP | Ø Antwortzeit | Fehlermeldung | Alt-Texte |', '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.model} | ${r.ok}/${r.anfragen} | ${r.status || '–'} | ${r.ms ? r.ms + ' ms' : '–'} | ${r.fehler ? '`' + esc(r.fehler) + '`' : ''} | ${r.alts.map((a) => `**${a.bild}:** ${esc(a.alt) || '*(' + a.state + ')*'}`).join('<br>')} |`),
  '', '### 2. Diagnose: Skript-Modelle direkt, Bild als öffentliche URL', '',
  '| Modell | HTTP | Antwort / Fehler |', '| --- | --- | --- |',
  ...direct.map((d) => `| ${d.model} | ${d.status} | ${d.text ? esc(d.text) : '`' + esc(d.error) + '`'} |`),
  '', `### 3. Aktuell verfügbare Bild-Modelle (${available.length}${modelsError ? ', Liste nicht abrufbar: ' + esc(modelsError) : ''})`, '',
  '| Modell | Provider | HTTP | Zeit | Antwort / Fehler |', '| --- | --- | --- | --- | --- |',
  ...extra.map((d) => `| ${d.model} | ${d.providers.join(', ')} | ${d.status} | ${d.ms} ms | ${d.text ? esc(d.text) : '`' + esc(d.error) + '`'} |`),
  '', available.length > extra.length ? `Weitere: ${available.slice(extra.length, extra.length + 25).map((m) => '`' + m.id + '`').join(', ')}` : '',
  '', rows.some((r) => r.ok) ? '✅ Mindestens ein Skript-Modell antwortet – die KI-Bildbeschreibung funktioniert.'
    : [...direct, ...extra].some((d) => d.status === 200) ? '⚠ Die Modelle im Skript antworten über den Skriptpfad nicht, andere Varianten aber schon (Tabellen 2/3) → Modellliste bzw. Bildübergabe im Skript anpassen.'
    : '❌ Kein Modell hat erfolgreich geantwortet (Key gültig? Berechtigung „Make calls to Inference Providers“? Guthaben?).', ''].join('\n');
writeFileSync(path.join(OUT, 'ai-check.md'), md);
writeFileSync(path.join(OUT, 'ai-check.json'), JSON.stringify({ rows, direct, available, extra }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (!rows.some((r) => r.ok)) process.exitCode = 1;
