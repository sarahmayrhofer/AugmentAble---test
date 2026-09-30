// Seiten-Evaluation: axe vorher/nachher je Seite, plus
//   (a) Recall gegen die in AccessGuru annotierten Violations
//   (b) Herkunft jedes "reparierten" Namens → bereinigtes Delta
//   (c) Schäden: überschriebene Namen, Warntext in title, falsches lang, versteckte SVG-Links
//
// PAGES_DIR=… überschreibt den Seitenordner (z. B. tests/fixtures für den Smoke-Test).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { franc } from 'franc-min';
import { launch, openPage, injectAugmentAble, runAxe, saveJson, meta, pool, CONFIG, aiLog } from '../harness/core.mjs';
import { loadViolations, localPages, splitAffected, norm, PAGES } from '../harness/dataset.mjs';

const pagesDir = process.env.PAGES_DIR ? path.resolve(process.env.PAGES_DIR) : PAGES;
let violations = [];
try { violations = loadViolations(); } catch (e) { console.warn('⚠', e.message, '→ ohne Annotationen'); }
const urlOf = new Map();
for (const v of violations) if (!urlOf.has(v.html_file_name)) urlOf.set(v.html_file_name, v.web_URL);
const annByPage = new Map();
for (const v of violations) (annByPage.get(v.html_file_name) || annByPage.set(v.html_file_name, []).get(v.html_file_name)).push(v);

const files = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => /\.html?$/.test(f)).sort() : [];
let todo = files;
if (CONFIG.LIMIT) todo = todo.slice(0, CONFIG.LIMIT);
console.log(`Seiten im Ordner: ${files.length}, ausgewertet: ${todo.length} (${CONFIG.NETWORK}, KI ${CONFIG.AI ? 'an' : 'aus'})`);

// ─── im Browser: Namen vor der Injektion festhalten ─────────────────────────
const CANDIDATES = 'a, button, input, select, textarea, svg, [role="button"], [role="link"], img, h1, h2, h3, h4, h5, h6';
const SNAPSHOT_NAMES = (sel) => {
  const ax = window.axe; ax.setup(document);
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    let nm = '';
    try { nm = ax.commons.text.accessibleTextVirtual(ax.utils.getNodeFromTree(el)).trim(); } catch {}
    el.setAttribute('data-eval-name0', nm);
    el.setAttribute('data-eval-title0', el.getAttribute('title') ?? '\u0000');
    n++;
  }
  ax.teardown();
  return { n, lang: document.documentElement.getAttribute('lang'), text: (document.body ? document.body.innerText : '').slice(0, 6000) };
};

// ─── im Browser: Auswertung nach der Injektion ──────────────────────────────
const ANALYZE = () => {
  const ax = window.axe; ax.setup(document);
  const accName = (el) => { try { return ax.commons.text.accessibleTextVirtual(ax.utils.getNodeFromTree(el)).trim(); } catch { return null; } };
  const hiddenForAT = (el) => !!el.closest('[aria-hidden="true"]');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, ' ');

  // Herkunft eines vom Skript gesetzten aria-label (Logik aus fixAriaLabels/fixForms nachgebildet)
  function labelSource(el) {
    const al = el.getAttribute('aria-label');
    if (al == null) return null;
    if (el.hasAttribute('data-a11y-form')) {
      if (el.placeholder && al === cap(el.placeholder)) return 'placeholder';
      if (el.name && al === cap(el.name)) return 'name-Attribut';
      if (al === 'Field') return 'Literal';
      return 'nur Feldtyp';
    }
    if (el.tagName === 'BUTTON') {
      const t = el.querySelector('title');
      if (t && al === t.textContent.trim()) return 'SVG-title';
      if (al === 'Button') return 'Literal';
      return 'aus CSS-Klasse geraten';
    }
    if (el.tagName === 'A') {
      const img = el.querySelector('img[alt]');
      if (img) return img.alt.trim() ? 'Bild-alt' : 'leeres Bild-alt';
      if (el.title && al === el.title.substring(0, 80)) return 'title-Attribut';
      if (al === 'Link') return 'Literal';
      return 'URL';
    }
    if (el.tagName.toLowerCase() === 'svg') return 'SVG-title';
    return 'sonstiges';
  }
  const BUCKET = {
    'SVG-title': 'belegt', 'Bild-alt': 'belegt', 'title-Attribut': 'belegt', placeholder: 'belegt',
    'name-Attribut': 'ungeprüft', 'aus CSS-Klasse geraten': 'ungeprüft',
    Literal: 'Schein', URL: 'Schein', 'nur Feldtyp': 'Schein', 'leeres Bild-alt': 'Schein', 'Warntext (title)': 'Schein', sonstiges: 'ungeprüft',
  };

  // Namensquelle eines Knotens, der nachher nicht mehr als Verstoß gilt
  function fixSource(el) {
    const nm = accName(el) || '';
    const al = el.getAttribute('aria-label');
    if ((el.hasAttribute('data-a11y-aria') || el.hasAttribute('data-a11y-form')) && al != null) {
      const s = labelSource(el); return { src: s, bucket: BUCKET[s] || 'ungeprüft', name: nm };
    }
    if (nm.startsWith('⚠')) return { src: 'Warntext (title)', bucket: 'Schein', name: nm };
    if (el.closest('[aria-hidden="true"]')) return { src: 'versteckt (aria-hidden)', bucket: 'versteckt', name: nm };
    if (el.getAttribute('data-a11y-misc')) return { src: 'tabindex/nav/video', bucket: 'belegt', name: nm };
    return { src: 'unklar', bucket: 'ungeprüft', name: nm };
  }

  // Alle vom Skript benannten Elemente
  const labels = [];
  for (const el of document.querySelectorAll('[data-a11y-aria], [data-a11y-form]')) {
    if (el.closest('#a11y-panel')) continue;
    const kind = el.hasAttribute('data-a11y-form') ? 'Formularfeld' : el.tagName === 'A' ? 'Link' : el.tagName === 'BUTTON' ? 'Button' : el.tagName.toLowerCase();
    if (kind === 'svg') continue;
    const s = labelSource(el);
    const before = el.getAttribute('data-eval-name0');
    labels.push({ kind, src: s, bucket: BUCKET[s] || 'ungeprüft', label: el.getAttribute('aria-label'), nameBefore: before, nameAfter: accName(el),
      noHref: el.tagName === 'A' && !el.hasAttribute('href'), html: el.outerHTML.slice(0, 180) });
  }

  // Überschriebene Namen: Element hatte vorher einen Namen, nachher einen anderen/keinen
  const overwritten = [];
  for (const el of document.querySelectorAll('[data-eval-name0]')) {
    if (el.closest('#a11y-panel')) continue;
    const b = el.getAttribute('data-eval-name0');
    if (!b) continue;
    const a = hiddenForAT(el) ? '' : (accName(el) || '');
    if (a !== b) overwritten.push({ tag: el.tagName.toLowerCase(), before: b.slice(0, 80), after: a.slice(0, 80), hidden: hiddenForAT(el),
      cause: el.closest('svg[data-a11y-aria][aria-hidden="true"]') ? 'SVG versteckt' : el.hasAttribute('data-a11y-form') || el.hasAttribute('data-a11y-aria') ? 'aria-label gesetzt' : a.startsWith('⚠') ? 'Warntext (title)' : 'anderes' });
  }

  // title-Attribute mit Warntext
  const warnTitles = [];
  for (const el of document.querySelectorAll('[data-a11y-label], [data-a11y-heading]')) {
    const t0 = el.getAttribute('data-eval-title0');
    const nm = accName(el) || '';
    warnTitles.push({ tag: el.tagName.toLowerCase(), hadTitle: t0 != null && t0 !== '\u0000' && t0 !== '', overwroteTitle: t0 != null && t0 !== '\u0000' && t0 !== '' && t0 !== el.title,
      isName: nm.startsWith('⚠'), title: el.title.slice(0, 80) });
  }

  const svgs = [...document.querySelectorAll('svg[data-a11y-aria]')].filter((s) => !s.closest('#a11y-panel'));
  const res = {
    labels, overwritten, warnTitles,
    sideEffects: {
      svgVersteckt: svgs.filter((s) => s.getAttribute('aria-hidden') === 'true').length,
      svgVersteckteLinks: svgs.filter((s) => s.getAttribute('aria-hidden') === 'true' && s.querySelector('a[href], a')).length,
      svgVersteckteFokussierbare: svgs.filter((s) => s.getAttribute('aria-hidden') === 'true' && s.querySelector('a[href], [tabindex]:not([tabindex="-1"])')).length,
      svgBenannt: svgs.filter((s) => s.getAttribute('role') === 'img').length,
      skipLink: !!document.getElementById('a11y-skip'),
      tabindexUmgeschrieben: [...document.querySelectorAll('[tabindex][data-a11y-misc]')].length,
      navBeschriftet: [...document.querySelectorAll('nav[data-a11y-misc]')].length,
      videoGemutet: [...document.querySelectorAll('video[data-a11y-misc]')].length,
      kontrastMarkiert: [...document.querySelectorAll('[data-a11y-contrast]')].filter((e) => !e.closest('#a11y-panel')).length,
      kiBilder: [...document.querySelectorAll('img[data-ai-done]')].reduce((o, i) => (o[i.getAttribute('data-ai-done') || 'retry'] = (o[i.getAttribute('data-ai-done') || 'retry'] || 0) + 1, o), {}),
      kiKandidaten: [...document.querySelectorAll('img')].filter((i) => i.width > 100 && i.height > 50 && (!i.alt || i.alt.trim() === '' || i.alt === i.src || i.alt === 'image') && i.src && i.naturalWidth > 50).length,
      bilderOhneAltGesamt: [...document.querySelectorAll('img:not([alt])')].length,
    },
    langAfter: document.documentElement.getAttribute('lang'),
    gm: { xhr: window.__augLog.gmXhr.length, prompts: window.__augLog.prompts },
    fixSource: null,
  };
  window.__fixSource = fixSource;
  ax.teardown();
  return res;
};

const FIX_SOURCES = (ids) => {
  const ax = window.axe; ax.setup(document);
  const out = {};
  for (const id of ids) {
    const el = document.querySelector(`[data-eval-id="${id}"]`);
    if (el) out[id] = window.__fixSource(el);
  }
  ax.teardown();
  return out;
};

// franc liefert ISO 639-3; lang-Attribute sind meist ISO 639-1
const ISO3 = { eng: 'en', deu: 'de', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', nld: 'nl', pol: 'pl', rus: 'ru', jpn: 'ja', cmn: 'zh', kor: 'ko', arb: 'ar', tur: 'tr', swe: 'sv', dan: 'da', nob: 'no', fin: 'fi', ces: 'cs', hun: 'hu', ell: 'el', heb: 'he', hin: 'hi', ukr: 'uk', ron: 'ro', ind: 'id', vie: 'vi', tha: 'th' };

// ─── Hauptschleife ──────────────────────────────────────────────────────────
const browser = await launch();
const pages = await pool(todo, CONFIG.CONCURRENCY, async (file) => {
  const html = readFileSync(path.join(pagesDir, file), 'utf8');
  const baseUrl = urlOf.get(file) || `https://fixture.test/${file}`;
  const r = { file, url: baseUrl };
  let context;
  try {
    const o = await openPage(browser, { pageId: file, baseUrl, html });
    context = o.context; const page = o.page;
    r.before = await runAxe(page, { phase: 'before' });
    const snap = await page.evaluate(SNAPSHOT_NAMES, CANDIDATES);
    r.langBefore = snap.lang;
    const fr = snap.text.replace(/\s+/g, ' ').length >= 200 ? franc(snap.text) : 'und';
    r.textLang = ISO3[fr] || fr;
    const { injectError } = await injectAugmentAble(page);
    r.injectError = injectError;
    r.after = await runAxe(page, { phase: 'after' });
    r.panel = await runAxe(page, { phase: 'panel', only: '#a11y-panel' }).catch(() => []);
    Object.assign(r, await page.evaluate(ANALYZE));
    // reparierte Knoten = vorher verletzt (evalId), nachher nicht mehr für dieselbe Regel
    const afterKeys = new Set(r.after.filter((n) => n.evalId).map((n) => n.rule + '|' + n.evalId));
    const fixedIds = [...new Set(r.before.filter((n) => n.evalId && !afterKeys.has(n.rule + '|' + n.evalId)).map((n) => n.evalId))];
    const src = await page.evaluate(FIX_SOURCES, fixedIds);
    r.fixed = r.before.filter((n) => n.evalId && !afterKeys.has(n.rule + '|' + n.evalId)).map((n) => {
      let s = src[n.evalId] || { src: 'Element entfernt', bucket: 'ungeprüft' };
      if (n.rule === 'html-has-lang' || n.rule === 'valid-lang') {
        // lang="en" wird ungeprüft gesetzt → gegen erkannte Textsprache prüfen (semantisch: lang-mismatch)
        s = { src: `lang="${r.langAfter}" gesetzt`, bucket: r.textLang === 'und' ? 'ungeprüft' : r.textLang === r.langAfter ? 'belegt' : 'Schein' };
      }
      return { rule: n.rule, evalId: n.evalId, ...s, name: (s.name || '').slice(0, 100) };
    });
    r.pageErrors = o.errors.filter((e) => e.fromScript);
    r.blockedRequests = o.blocked.length;
  } catch (e) {
    r.failed = String(e.message || e).split('\n')[0];
  } finally { if (context) await context.close().catch(() => {}); }

  // Annotierte Violations dieser Seite
  if (!r.failed) {
    r.annotations = (annByPage.get(file) || []).filter((v) => v.violation_category !== 'Semantic').map((v) => {
      const els = splitAffected(v.affected_html_elements);
      const beforeNodes = r.before.filter((n) => n.rule === v.violation_name);
      const matched = els.map((h) => {
        const nh = norm(h);
        const hit = beforeNodes.find((n) => norm(n.html) === nh) || beforeNodes.find((n) => norm(n.html).slice(0, 120) === nh.slice(0, 120));
        return hit ? hit.evalId : null;
      });
      const fixedSet = new Map(r.fixed.filter((f) => f.rule === v.violation_name).map((f) => [f.evalId, f]));
      const m = matched.filter(Boolean);
      const fixedM = m.filter((id) => fixedSet.has(id));
      let status;
      if (!m.length) status = 'nicht zuordenbar';
      else if (fixedM.length === m.length) status = 'behoben';
      else if (fixedM.length) status = 'teilweise';
      else status = 'nicht behoben';
      const buckets = fixedM.map((id) => fixedSet.get(id).bucket);
      return { rule: v.violation_name, category: v.violation_category, impact: v.violation_impact, n: els.length, matched: m.length, fixed: fixedM.length, status, buckets };
    });
  }
  process.stdout.write(r.failed ? 'x' : r.injectError ? '!' : '.');
  return r;
});
await browser.close();
console.log();

// schlanke Speicherung: Knotenlisten auf Regel+Marker reduzieren
for (const p of pages) {
  for (const k of ['before', 'after', 'panel']) if (p[k]) p[k] = p[k].map(({ rule, impact, evalId, marker, html }) => ({ rule, impact, evalId, marker, html: html.slice(0, 160) }));
}
saveJson('pages.json', { meta: meta(), pagesDir: path.relative(process.cwd(), pagesDir), snapshot: existsSync(path.join(pagesDir, '_snapshot.json')) ? JSON.parse(readFileSync(path.join(pagesDir, '_snapshot.json'), 'utf8')).created : null, pages, ai: aiLog });
const ok = pages.filter((p) => !p.failed);
console.log(`fertig: ${ok.length} ausgewertet, ${pages.length - ok.length} fehlgeschlagen, ${ok.filter((p) => p.injectError).length} mit Skriptabsturz`);
