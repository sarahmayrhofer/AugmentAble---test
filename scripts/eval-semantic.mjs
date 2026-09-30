// Semantische Kategorie: AugmentAble gegen die Expertenkorrekturen aus AccessGuru.
//
// Für jeden der 55 semantischen Fälle (je 3 Entwickler-Korrekturen):
//   vorher  = relevante Werte im Original (z. B. Linknamen, lang-Werte, Alt-Texte)
//   nachher = dieselben Werte nach AugmentAble
//   Mensch  = dieselben Werte in jeder der drei Korrekturen
// Ähnlichkeit wie im AccessGuru-Paper: SBERT-Kosinus für Text, Jaccard für lang-Mengen
// (Berechnung in scripts/similarity.py). Entscheidend ist das Delta nachher − vorher:
// Bewegt das Skript den Code in Richtung der Expertenkorrektur?
//
// Zusätzlich "KI-Pfad": Das Bild jedes Bildfalls wird ohne alt eingebettet, damit der
// unveränderte Skriptpfad (processNextImage → HuggingFace) auslöst. Nur mit AI=1 + HF_API_KEY.
import { launch, openPage, injectAugmentAble, saveJson, meta, aiLog, CONFIG, pool } from '../harness/core.mjs';
import { loadSemanticSample } from '../harness/dataset.mjs';

const TEXT_FIELD = {
  'image-alt-not-descriptive': 'images',
  'link-text-mismatch': 'links',
  'button-label-mismatch': 'buttons',
  'form-label-mismatch': 'fields',
  'ambiguous-heading': 'headings',
  'page-title-not-descriptive': 'title',
  'lang-mismatch': 'langs',
  'missing-lang-tag': 'langs',
};

// Läuft im Browser: extrahiert alle potenziell relevanten zugänglichen Namen.
const EXTRACT = () => {
  const ax = window.axe;
  ax.setup(document);
  const name = (el) => { try { return ax.commons.text.accessibleTextVirtual(ax.utils.getNodeFromTree(el)).trim(); } catch { return null; } };
  const vis = (sel) => [...document.querySelectorAll(sel)].filter((el) => !el.closest('#a11y-panel') && el.id !== 'a11y-skip');
  const res = {
    images: vis('img, svg[role="img"], [role="img"], canvas, input[type="image"]').map(name),
    links: vis('a[href], [role="link"]').map(name),
    buttons: vis('button, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], [role="button"]').map(name),
    fields: vis('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea').map(name),
    headings: vis('h1,h2,h3,h4,h5,h6,[role="heading"]').map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
    title: [document.title.trim()],
    langs: vis('[lang]').map((el) => el.getAttribute('lang').trim().toLowerCase()),
    titles_attr: vis('[title]').map((el) => el.getAttribute('title')),
  };
  ax.teardown();
  return res;
};

const items = loadSemanticSample();
const browser = await launch();
const results = await pool(items, CONFIG.CONCURRENCY, async (it) => {
  const field = TEXT_FIELD[it.type];
  const isImage = it.type === 'image-alt-not-descriptive';
  const routes = isImage ? { '': it.image } : {};
  const base = 'https://semantic.test/item' + it.no + '/';
  const r = { no: it.no, type: it.type, field, kind: field === 'langs' ? 'set' : 'text' };

  // Original + AugmentAble
  {
    const { page, context, errors } = await openPage(browser, { pageId: 'sem-' + it.no, baseUrl: base, html: it.html, extraRoutes: routes });
    r.before = await page.evaluate(EXTRACT);
    const { injectError } = await injectAugmentAble(page);
    r.injectError = injectError;
    r.after = await page.evaluate(EXTRACT);
    r.markers = await page.evaluate(() => [...document.querySelectorAll('[data-a11y-aria],[data-a11y-form],[data-a11y-label],[data-a11y-heading],[data-ai-done]')]
      .filter((el) => !el.closest('#a11y-panel')).map((el) => el.outerHTML.slice(0, 200)));
    r.errors = errors;
    await context.close();
  }
  // Menschliche Korrekturen
  r.human = [];
  for (const h of it.human) {
    if (!h) { r.human.push(null); continue; }
    const { page, context } = await openPage(browser, { pageId: 'sem-h-' + it.no, baseUrl: base, html: h, extraRoutes: routes });
    r.human.push(await page.evaluate(EXTRACT));
    await context.close();
  }
  r.changed = JSON.stringify(r.before[field]) !== JSON.stringify(r.after[field]);

  // KI-Pfad (nur Bildfälle): gleiches Bild, alt fehlt → Skript soll beschreiben
  if (isImage) {
    const html = `<!doctype html><html lang="en"><head><title>Bild ${it.no}</title></head><body><main><img src="https://semantic.test/img${it.no}.png" style="width:480px;height:auto"></main></body></html>`;
    const { page, context } = await openPage(browser, { pageId: 'sem-ai-' + it.no, baseUrl: base + 'ai', html, extraRoutes: { ['img' + it.no + '.png']: it.image } });
    await injectAugmentAble(page);
    r.ai = await page.evaluate(() => {
      const img = document.querySelector('main img');
      return { alt: img.getAttribute('alt'), state: img.getAttribute('data-ai-done'), calls: window.__augLog.gmXhr.map(({ status, ms, cached, model }) => ({ status, ms, cached, model })) };
    });
    await context.close();
  }
  process.stdout.write('.');
  return r;
});
await browser.close();
console.log();

const byType = {};
for (const r of results) {
  const t = (byType[r.type] ||= { n: 0, angefasst: 0 });
  t.n++; if (r.changed) t.angefasst++;
}
console.table(byType);
saveJson('semantic.json', { meta: meta(), items: results, byType, ai: aiLog.filter((a) => String(a.page).startsWith('sem-')) });
