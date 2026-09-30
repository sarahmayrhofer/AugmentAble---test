// Gemeinsamer Kern der Evaluation: Browser, Tampermonkey-Shim, Injektion, axe.
//
// Grundsatz: Das Userscript wird NICHT verändert. Einzige Ausnahme (nur im KI-Modus
// und im Report ausgewiesen): das 6-Sekunden-Intervall der Bildverarbeitung wird
// verkürzt, weil sonst eine Seite mit 40 Bildern 4 Minuten bräuchte.

import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ─── Konfiguration (alles über Umgebungsvariablen, landet im Report) ─────────
export const CONFIG = {
  AI: process.env.AI === '1',
  HF_KEY_PRESENT: !!process.env.HF_API_KEY || !!process.env.AI_MOCK,
  NETWORK: process.env.NETWORK || 'offline',          // offline | live
  SETTLE_MS: +(process.env.SETTLE_MS || 2500),         // Wartezeit nach Injektion (Observer-Debounce 800 ms)
  AI_INTERVAL_MS: +(process.env.AI_INTERVAL_MS || 400),// statt 6000 ms, nur im KI-Modus
  AI_WAIT_MS: +(process.env.AI_WAIT_MS || 45000),      // max. Wartezeit auf KI-Antworten je Seite
  LIMIT: process.env.LIMIT ? +process.env.LIMIT : null,
  CONCURRENCY: +(process.env.CONCURRENCY || 4),
  AXE_TAGS: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'best-practice'],
};

export const OUT = path.join(ROOT, 'results');
mkdirSync(OUT, { recursive: true });

export const USERSCRIPT_PATH = path.join(ROOT, 'userscript', 'augmentable.user.js');
const USERSCRIPT_RAW = readFileSync(USERSCRIPT_PATH, 'utf8');
export const USERSCRIPT_SHA256 = createHash('sha256').update(USERSCRIPT_RAW).digest('hex');
export const USERSCRIPT_VERSION = (USERSCRIPT_RAW.match(/@version\s+(\S+)/) || [])[1];
const AXE_SRC = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
export const AXE_VERSION = require('axe-core/package.json').version;

function userscriptSource() {
  let src = USERSCRIPT_RAW;
  if (CONFIG.AI) {
    const before = src;
    src = src.replace('setInterval(processNextImage, 6000)', `setInterval(processNextImage, ${CONFIG.AI_INTERVAL_MS})`);
    if (src === before) throw new Error('Intervall-Zeile im Userscript nicht gefunden – Harness an neue Skriptversion anpassen');
  }
  // Tampermonkey-Umgebung nachbilden: GM_* als lokale Variablen der IIFE.
  return `(function(GM_getValue, GM_setValue, GM_xmlhttpRequest){\n${src}\n})(window.__augShim.GM_getValue, window.__augShim.GM_setValue, window.__augShim.GM_xmlhttpRequest);\n//# sourceURL=augmentable.user.js`;
}

// Läuft vor jedem Seitenskript. Bildet Tampermonkey nach und protokolliert alles.
const SHIM = (aiEnabled) => {
  const log = { gmXhr: [], prompts: 0, gmSet: [] };
  window.__augLog = log;
  window.__augShim = {
    GM_getValue: (k, d) => (k === 'hf_api_key' ? (aiEnabled ? 'HARNESS_PLACEHOLDER' : '') : d),
    GM_setValue: (k, v) => { log.gmSet.push(k); },
    GM_xmlhttpRequest: (details) => {
      const entry = { url: details.url, t0: Date.now() };
      log.gmXhr.push(entry);
      // Der echte Key bleibt im Node-Prozess; die Seite sieht ihn nie.
      window.__augXhr({ url: details.url, method: details.method, data: details.data })
        .then((res) => {
          entry.status = res.status; entry.ms = Date.now() - entry.t0; entry.cached = res.cached; entry.model = res.model;
          if (res.status === 0) { details.onerror && details.onerror(res); }
          else { details.onload && details.onload({ status: res.status, responseText: res.responseText }); }
        })
        .catch((e) => { entry.status = -1; entry.err = String(e); details.onerror && details.onerror({}); });
    },
  };
  // Ohne Key fragt das Skript per prompt(); Tampermonkey-Nutzer ohne Key klicken "Abbrechen".
  window.prompt = () => { log.prompts++; return null; };
};

// ─── KI-Proxy mit Cache (Reproduzierbarkeit) ─────────────────────────────────
const CACHE_DIR = path.join(ROOT, 'cache', 'ai');
export const aiLog = [];
async function aiProxy(req, pageId) {
  const body = req.data || '';
  let model = null; try { model = JSON.parse(body).model; } catch {}
  const key = createHash('sha256').update(req.url + '\n' + body).digest('hex');
  const file = path.join(CACHE_DIR, key + '.json');
  const rec = { page: pageId, model, key, t: new Date().toISOString() };
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    aiLog.push({ ...rec, status: c.status, cached: true, text: extractText(c.responseText) });
    return { ...c, cached: true, model };
  }
  if (CONFIG.AI && process.env.AI_MOCK) {
    // Test der Verkabelung ohne echten API-Aufruf
    const responseText = JSON.stringify({ choices: [{ message: { content: 'MOCK description of the image' } }] });
    aiLog.push({ ...rec, status: 200, cached: false, mock: true, text: 'MOCK description of the image' });
    return { status: 200, responseText, cached: false, model };
  }
  if (!CONFIG.AI || !process.env.HF_API_KEY) {
    aiLog.push({ ...rec, status: 0, blocked: true });
    return { status: 0, responseText: '', model };
  }
  const t0 = Date.now();
  let status = 0, responseText = '';
  try {
    const r = await fetch(req.url, {
      method: req.method || 'POST',
      headers: { Authorization: `Bearer ${process.env.HF_API_KEY}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    status = r.status; responseText = await r.text();
  } catch (e) { status = 0; responseText = JSON.stringify({ error: String(e) }); }
  const out = { status, responseText };
  mkdirSync(CACHE_DIR, { recursive: true });
  if (status === 200) writeFileSync(file, JSON.stringify(out));
  aiLog.push({ ...rec, status, cached: false, ms: Date.now() - t0, text: extractText(responseText) });
  return { ...out, cached: false, model };
}
function extractText(rt) { try { return JSON.parse(rt).choices[0].message.content.trim(); } catch { return null; } }

// ─── Browser & Seiten ───────────────────────────────────────────────────────
export async function launch() {
  return chromium.launch({ args: ['--disable-web-security'] });
}

/**
 * Öffnet eine Seite. html wird unter baseUrl ausgeliefert (Origin bleibt erhalten).
 * offline: alle anderen Requests werden abgebrochen (außer extraRoutes).
 */
export async function openPage(browser, { pageId, baseUrl, html, extraRoutes = {} }) {
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  page.on('pageerror', (e) => errors.push({ msg: String(e.message || e), fromScript: /augmentable\.user\.js/.test(e.stack || '') }));
  await page.exposeFunction('__augXhr', (req) => aiProxy(req, pageId));
  await page.addInitScript(SHIM, CONFIG.AI);
  const main = new URL(baseUrl).href;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame() && url.split('#')[0] === main.split('#')[0]) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    for (const [pattern, file] of Object.entries(extraRoutes)) {
      if (url.includes(pattern)) return route.fulfill({ path: file });
    }
    if (CONFIG.NETWORK === 'offline') { blocked.push(url); return route.abort(); }
    return route.continue();
  });
  await page.goto(main, { waitUntil: 'load', timeout: 45000 }).catch(async (e) => {
    // Hängende Subressourcen im Live-Modus: mit DOM weiterarbeiten
    if (!/Timeout/.test(String(e))) throw e;
  });
  await page.evaluate(AXE_SRC);
  return { page, context, errors, blocked };
}

/** Injiziert AugmentAble und wartet, bis Observer-Durchläufe (und ggf. KI) abgeschlossen sind. */
export async function injectAugmentAble(page) {
  let injectError = null;
  try {
    await page.evaluate(userscriptSource());
  } catch (e) {
    injectError = String(e.message || e).split('\n')[0];
  }
  await page.waitForTimeout(CONFIG.SETTLE_MS);
  if (CONFIG.AI && !injectError) {
    // warten, bis keine Bilder mehr in Bearbeitung sind
    const t0 = Date.now();
    while (Date.now() - t0 < CONFIG.AI_WAIT_MS) {
      const pending = await page.evaluate(() => {
        const trying = document.querySelectorAll('img[data-ai-done="trying"]').length;
        const open = (window.__augLog.gmXhr || []).filter((x) => x.status === undefined).length;
        return trying + open;
      });
      if (!pending) {
        // eine Intervallrunde abwarten, ob ein weiteres Bild aufgegriffen wird
        await page.waitForTimeout(CONFIG.AI_INTERVAL_MS * 2);
        const again = await page.evaluate(() => document.querySelectorAll('img[data-ai-done="trying"]').length);
        if (!again) break;
      }
      await page.waitForTimeout(500);
    }
  }
  return { injectError };
}

/**
 * axe-Scan. Markiert jedes verletzende Element mit data-eval-id, damit es nach der
 * Injektion wiedergefunden wird (Selektoren verschieben sich, sobald der Skip-Link
 * als erstes body-Kind eingefügt wird).
 */
export async function runAxe(page, { phase, only = null }) {
  return page.evaluate(async ({ tags, phase, only }) => {
    const ctx = only ? { include: [only] } : { exclude: [['#a11y-panel']] };
    const res = await window.axe.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    let n = window.__evalSeq || 0;
    const out = [];
    for (const v of res.violations) {
      for (const node of v.nodes) {
        let el = null;
        try { el = document.querySelector(node.target[node.target.length - 1]); } catch {}
        if (node.target.length > 1) el = null; // Shadow-DOM/iframe: nicht markierbar
        let id = el ? el.getAttribute('data-eval-id') : null;
        if (el && !id && phase === 'before') { id = 'e' + (++n); el.setAttribute('data-eval-id', id); }
        out.push({ rule: v.id, impact: v.impact, tags: v.tags, html: node.html, target: node.target.join(' >>> '), evalId: id,
          marker: el ? {
            aria: el.getAttribute('data-a11y-aria'), form: el.getAttribute('data-a11y-form'),
            contrast: el.getAttribute('data-a11y-contrast'), misc: el.getAttribute('data-a11y-misc'),
            label: el.getAttribute('data-a11y-label'), heading: el.getAttribute('data-a11y-heading'),
          } : null });
      }
    }
    window.__evalSeq = n;
    return out;
  }, { tags: CONFIG.AXE_TAGS, phase, only });
}

/** Einfache Worker-Queue */
export async function pool(items, n, fn) {
  let i = 0; const res = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); }
  }));
  return res;
}

export function meta() {
  return {
    created: new Date().toISOString(),
    userscript: { version: USERSCRIPT_VERSION, sha256: USERSCRIPT_SHA256 },
    axe: AXE_VERSION,
    chromium: null,
    config: { ...CONFIG, HF_KEY_PRESENT: !!process.env.HF_API_KEY, AI_MOCK: !!process.env.AI_MOCK },
    aiIntervalPatched: CONFIG.AI ? `6000 → ${CONFIG.AI_INTERVAL_MS} ms` : null,
    git: process.env.GITHUB_SHA || null,
  };
}

export function saveJson(name, obj) {
  writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 1));
}
