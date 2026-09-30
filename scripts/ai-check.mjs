// KI-Check: Funktioniert die Bildbeschreibung mit echtem HuggingFace-Aufruf?
//
// Für jedes Modell der Fallback-Kette des Skripts werden 3 Bilder über den unveränderten
// Skriptpfad (processNextImage → Canvas → GM_xmlhttpRequest) beschrieben. Damit jedes Modell
// einzeln geprüft wird, stellt die Harness das jeweilige Modell an den Anfang der MODELS-Liste
// (einzige Änderung am Skripttext, nur hier).
//
//   HF_API_KEY=hf_… npm run ai-check            (SCRIPT=fixed|original, Standard fixed)
process.env.AI = '1';
process.env.AI_NO_CACHE = '1';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launch, openPage, injectAugmentAble, loadScript, SCRIPT, OUT } from '../harness/core.mjs';
import { AG } from '../harness/dataset.mjs';

if (!process.env.HF_API_KEY) {
  console.error('✗ HF_API_KEY fehlt. In GitHub: Settings → Secrets and variables → Actions → New repository secret "HF_API_KEY".');
  process.exit(1);
}

const script = loadScript(SCRIPT);
const models = [...script.raw.matchAll(/'([^']+:[a-z-]+)'/g)].map((m) => m[1]).filter((m) => m.includes('/'));
const supp = path.join(AG, 'data', 'accessguru_dataset', 'accessguru_semantic_violations_sampled_dataset_supp_material');
const IMAGES = [
  { file: '1.png', note: 'Logo (W3C)' },
  { file: '50.png', note: 'Diagramm (Klimadaten)' },
  { file: '52.png', note: 'Webseiten-Ausschnitt' },
].filter((i) => existsSync(path.join(supp, i.file)));
if (!IMAGES.length) { console.error('✗ Testbilder fehlen – zuerst "npm run fetch" (SKIP_DARUS=1 genügt).'); process.exit(1); }

const html = `<!doctype html><html lang="en"><head><title>KI-Check</title></head><body><main><h1>Image check</h1>${IMAGES.map((i, k) => `<figure><img id="i${k}" src="https://ki-check.test/${i.file}" style="width:480px;height:auto"><figcaption>${i.note}</figcaption></figure>`).join('')}</main></body></html>`;
const routes = Object.fromEntries(IMAGES.map((i) => [i.file, path.join(supp, i.file)]));

const browser = await launch();
const rows = [];
for (const model of models) {
  // gewünschtes Modell an den Anfang der Kette
  const order = [model, ...models.filter((m) => m !== model)];
  const raw = script.raw.replace(/const MODELS\s*=\s*\[[\s\S]*?\];/, `const MODELS = [${order.map((m) => `'${m}'`).join(', ')}];`);
  const { page, context } = await openPage(browser, { pageId: 'ki-check-' + model, baseUrl: 'https://ki-check.test/', html, extraRoutes: routes, ai: true });
  await injectAugmentAble(page, { raw, ai: true });
  const res = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll('main img')].map((i) => ({ alt: i.getAttribute('alt'), state: i.getAttribute('data-ai-done'), model: i.getAttribute('data-ai-model') })),
    calls: window.__augLog.gmXhr.map(({ status, ms, requestModel }) => ({ status, ms, model: requestModel })),
  }));
  await context.close();
  const own = res.calls.filter((c) => c.model === model);
  const ok = own.filter((c) => c.status === 200);
  rows.push({ model, anfragen: own.length, ok: ok.length, status: [...new Set(own.map((c) => c.status))].join(','),
    ms: ok.length ? Math.round(ok.reduce((s, c) => s + c.ms, 0) / ok.length) : null,
    fallback: res.calls.filter((c) => c.model !== model).map((c) => c.model),
    alts: res.imgs.map((i, k) => ({ bild: IMAGES[k].note, alt: i.alt, state: i.state, von: i.model })) });
  const r = rows.at(-1);
  console.log(`${r.ok ? '✓' : '✗'} ${model}: ${r.ok}/${r.anfragen} erfolgreich, HTTP ${r.status || '–'}, Ø ${r.ms ?? '–'} ms`);
  for (const a of r.alts) console.log(`    ${a.bild}: ${a.alt ? JSON.stringify(a.alt) : '(' + a.state + ')'}${a.von && a.von !== model ? ' [via ' + a.von + ']' : ''}`);
}
await browser.close();

const md = ['## KI-Check (echte HuggingFace-Aufrufe)', '', `Skript: ${SCRIPT} v${script.version}`, '',
  '| Modell | erfolgreich | HTTP | Ø Antwortzeit | Beispiel-Alt-Texte |', '| --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.model} | ${r.ok}/${r.anfragen} | ${r.status || '–'} | ${r.ms ? r.ms + ' ms' : '–'} | ${r.alts.map((a) => `**${a.bild}:** ${a.alt || '*(' + a.state + ')*'}${a.von && a.von !== r.model ? ` *(via ${a.von})*` : ''}`).join('<br>')} |`),
  '', rows.some((r) => r.ok) ? '✅ Mindestens ein Modell antwortet – die KI-Bildbeschreibung funktioniert.' : '❌ Kein Modell hat erfolgreich geantwortet (Key gültig? Inference-Provider-Berechtigung? Modell noch verfügbar?).', ''].join('\n');
writeFileSync(path.join(OUT, 'ai-check.md'), md);
writeFileSync(path.join(OUT, 'ai-check.json'), JSON.stringify(rows, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (!rows.some((r) => r.ok)) process.exitCode = 1;
