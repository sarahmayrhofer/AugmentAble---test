// KI-Qualität auf VizWiz-Captions (echte HuggingFace-Aufrufe, AI=1 + HF_API_KEY nötig).
//
// Je Bild der Stichprobe:
//   1. englische Seite  → Alt-Text über den unveränderten Skriptpfad
//   2. deutsche Seite   → Sprache des Alt-Texts (VIZWIZ_DE Bilder, Standard 20)
//   3. Wiederholung     → Stabilität, ohne Cache (VIZWIZ_REPEAT Bilder, Standard 20)
// Ähnlichkeit zu den 5 menschlichen Beschreibungen: scripts/vizwiz_similarity.py
process.env.AI = '1';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { franc } from 'franc-min';
import { launch, openPage, injectAugmentAble, saveJson, meta, pool, CONFIG, SCRIPT, loadScript } from '../harness/core.mjs';
import { DATA } from '../harness/dataset.mjs';

if (!process.env.HF_API_KEY && !process.env.AI_MOCK) { console.error('✗ HF_API_KEY fehlt'); process.exit(1); }
const DIR = path.join(DATA, 'vizwiz');
if (!existsSync(path.join(DIR, 'sample.json'))) { console.error('✗ zuerst "npm run fetch:vizwiz"'); process.exit(1); }
const sample = JSON.parse(readFileSync(path.join(DIR, 'sample.json'), 'utf8')).filter((x) => existsSync(path.join(DIR, 'val', x.file)));
const N_DE = +(process.env.VIZWIZ_DE || 20), N_REP = +(process.env.VIZWIZ_REPEAT || 20);
const script = loadScript(SCRIPT);

const pageHtml = (file, lang) => lang === 'de'
  ? `<!doctype html><html lang="de"><head><title>Foto</title></head><body><main><h1>Foto aus dem Alltag</h1><img src="https://vizwiz.test/${file}" style="width:480px;height:auto"></main></body></html>`
  : `<!doctype html><html lang="en"><head><title>Photo</title></head><body><main><h1>Everyday photo</h1><img src="https://vizwiz.test/${file}" style="width:480px;height:auto"></main></body></html>`;

async function describe(browser, item, lang, tag) {
  const { page, context } = await openPage(browser, { pageId: `vizwiz-${tag}-${item.file}`, baseUrl: `https://vizwiz.test/${tag}/`, html: pageHtml(item.file, lang),
    extraRoutes: { [item.file]: path.join(DIR, 'val', item.file) }, ai: true });
  await injectAugmentAble(page, { raw: script.raw, ai: true });
  const r = await page.evaluate(() => { const i = document.querySelector('main img'); const c = window.__augLog.gmXhr.at(-1) || {};
    return { alt: i.getAttribute('alt'), state: i.getAttribute('data-ai-done'), model: i.getAttribute('data-ai-model') || c.requestModel, status: c.status, ms: c.ms, calls: window.__augLog.gmXhr.length }; });
  await context.close();
  return r;
}
const langOf = (t) => (t && t.length >= 10 ? franc(t, { minLength: 10 }) : 'und');

const browser = await launch();
const items = await pool(sample, CONFIG.CONCURRENCY, async (item, k) => {
  const r = { file: item.file, captions: item.captions, text_detected: item.text_detected };
  r.en = await describe(browser, item, 'en', 'en');
  if (k < N_DE) { r.de = await describe(browser, item, 'de', 'de'); r.de.lang = langOf(r.de.alt); }
  process.stdout.write(r.en.alt ? '.' : 'x');
  return r;
});
// Stabilität: dieselben Bilder erneut, ohne Cache
process.env.AI_NO_CACHE = '1';
await pool(items.slice(0, N_REP), CONFIG.CONCURRENCY, async (r) => { r.repeat = await describe(browser, { file: r.file }, 'en', 'rep'); });
delete process.env.AI_NO_CACHE;
await browser.close();
console.log();

const ok = items.filter((r) => r.en.alt);
const de = items.filter((r) => r.de);
console.log(`beschrieben: ${ok.length}/${items.length}; deutsche Seite → deutscher Alt-Text: ${de.filter((r) => r.de.lang === 'deu').length}/${de.length}`);
saveJson('vizwiz.json', { meta: meta(), n: items.length, items });
