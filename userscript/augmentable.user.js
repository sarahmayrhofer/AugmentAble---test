// ==UserScript==
// @name         AugmentAbleDemo
// @namespace    http://tampermonkey.net/
// @version      141.1
// @description  AI Image Description (opt-in), Contrast, ARIA, Forms, Landmarks, Heading Check & Focus Enforcer
// @author       Your Name / Research Group
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      router.huggingface.co
// @run-at       document-idle
// ==/UserScript==

/*
 * Änderungen gegenüber v140 (Bezug: Evaluation gegen AccessGuru, Review-Kritikpunkte)
 *
 *  K1  Kontrast: effektiver Hintergrund über die Elternkette (inkl. Transparenz), Hintergrundbilder
 *      werden nicht angefasst; Farbe wird in die Richtung verschoben, die die Schwelle erreicht
 *      (auf dunklem Grund heller statt schwärzer). Marker nur, wenn die Farbe sich wirklich ändert.
 *  K2  Keine Diagnosetexte mehr in title: Heading-/Label-Befunde stehen nur im Panel und in
 *      data-Attributen (für Screenreader unsichtbar).
 *  K3  Keine Platzhalter-Namen ("Button", "Link", "Field", Feldtyp, URL). Namen nur aus inhaltlichen
 *      Quellen; ohne Quelle wird nichts gesetzt, sondern im Panel gemeldet. Quelle steht in
 *      data-a11y-src.
 *  K4  Vorhandene Namen werden nicht überschrieben: Prüfung über el.labels (umschließende und
 *      for-Labels), aria-labelledby, title, alt bei input[type=image], Standardnamen von submit/reset,
 *      Text/Bild-alt in Buttons und Links.
 *  K5  <a> ohne href ist kein Link und bekommt kein aria-label (aria-prohibited-attr).
 *  K6  SVGs mit Links, fokussierbarem Inhalt oder Text werden nicht mehr versteckt.
 *  K7  lang wird nur gesetzt, wenn die Sprache erkannt ist (Meta-Angaben oder Stoppwort-Heuristik);
 *      sonst Hinweis im Panel.
 *  K8  Kein Absturz mehr durch ungewöhnliche IDs (kein querySelector mit interpolierter ID);
 *      jedes Modul läuft isoliert (ein Fehler stoppt nicht die übrigen).
 *  K9  KI-Bildbeschreibung ist opt-in (Schalter im Panel), der API-Key wird erst dann abgefragt.
 *      Bilder in bereits benannten Links/Buttons bekommen alt="" statt einer KI-Beschreibung.
 *      Der Prompt enthält Seitensprache und Kontext (figcaption/Überschrift); bei CORS-Fehler wird
 *      die Bild-URL statt Canvas-Daten gesendet. Das Overlay erscheint nur im Hervorhebungsmodus.
 *      Modellliste aktualisiert (KI-Check 2026-10), Fallback auf das nächste Modell bei jedem
 *      Modellfehler; bei fehlendem Guthaben/ungültigem Key Hinweis im Panel statt weiterer Anfragen.
 *  K10 Panel: Farben mit AAA-Kontrast, Landmark (aside mit Namen), scrollbare Bereiche fokussierbar.
 */

(function() {
    'use strict';

    // ─── Einstellungen ───────────────────────────────────────────────────────
    let AI_ENABLED = !!GM_getValue('ai_enabled', false);
    let HF_KEY     = GM_getValue('hf_api_key', '');

    const API_URL = 'https://router.huggingface.co/v1/chat/completions';
    // Stand KI-Check 2026-10: die v140-Modelle Qwen2.5-VL-7B (nebius) und Qwen2-VL-7B sind bei
    // HuggingFace nicht mehr verfügbar. Kein fester Provider mehr – der Router wählt selbst.
    const MODELS  = [
        'CohereLabs/aya-vision-32b',
        'Qwen/Qwen3-VL-30B-A3B-Instruct',
        'google/gemma-3-27b-it'
    ];
    let aiBlocked = false; // z. B. kein Guthaben – dann keine weiteren Anfragen
    let modelIndex  = 0;
    let highlightOn = false;
    let stats       = { altText:0, ariaLabels:0, contrast:0, forms:0, misc:0, headings:0, labels:0 };
    const reported  = new Set();

    // Jedes Modul isoliert ausführen (K8)
    function safe(name, fn) {
        try { fn(); }
        catch (e) { console.warn('AugmentAble: Modul ' + name + ' fehlgeschlagen:', e); logIssue('⚙ ' + name + ': ' + (e && e.message || e)); }
    }

    // ─── Hilfsfunktionen: zugänglicher Name ──────────────────────────────────
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const textOf = (el) => norm(el && el.textContent);
    function idrefText(el, attr) {
        return norm((el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)
            .map(id => { const t = document.getElementById(id); return t ? textOf(t) : ''; }).join(' '));
    }
    function isInPanel(el) { return !!(el.closest && el.closest('#a11y-panel')); }

    function hasAccessibleName(el) {
        if (norm(el.getAttribute('aria-label'))) return true;
        if (el.hasAttribute('aria-labelledby') && idrefText(el, 'aria-labelledby')) return true;
        if (el.labels && Array.prototype.some.call(el.labels, l => textOf(l))) return true;
        if (norm(el.getAttribute('title'))) return true;
        if (el.tagName === 'INPUT') {
            const t = (el.getAttribute('type') || 'text').toLowerCase();
            if (t === 'image') return !!norm(el.getAttribute('alt'));
            if (t === 'submit' || t === 'reset') return true;           // Browser-Standardname
            if (t === 'button') return !!norm(el.value);
        }
        const role = el.getAttribute('role');
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || role === 'button' || role === 'link') {
            if (textOf(el)) return true;
            if (Array.prototype.some.call(el.querySelectorAll('img[alt]'), i => norm(i.alt))) return true;
            if (Array.prototype.some.call(el.querySelectorAll('[aria-label]'), x => norm(x.getAttribute('aria-label')))) return true;
        }
        return false;
    }

    function setName(el, value, source, marker) {
        el.setAttribute('aria-label', value);
        el.setAttribute('data-a11y-src', source);
        el.setAttribute(marker, '1');
    }

    // ─── HIGHLIGHT ───────────────────────────────────────────────────────────────────────
    function enableHighlights() {
        if (document.getElementById('a11y-hl-style')) return;
        const s = document.createElement('style');
        s.id = 'a11y-hl-style';
        s.textContent = `
            [data-ai-done="done"], [data-a11y-aria="1"], [data-a11y-form="1"], [data-a11y-contrast="1"],
            [data-a11y-heading], [data-a11y-label] {
                outline: 6px solid #a855f7 !important; outline-offset: 4px !important;
                box-shadow: 0 0 0 9px rgba(168,85,247,0.30), 0 0 16px 4px rgba(168,85,247,0.45) !important;
            }
            .ai-overlay { display: block !important; }
        `;
        document.head.appendChild(s);
    }
    function disableHighlights() {
        const s = document.getElementById('a11y-hl-style');
        if (s) s.remove();
    }
    function toggleHighlight() {
        highlightOn = !highlightOn;
        const btn = document.getElementById('a11y-toggle-btn');
        if (btn) {
            btn.textContent      = highlightOn ? '🟢 Outlines ON' : '⚪ Outlines OFF';
            btn.setAttribute('aria-pressed', String(highlightOn));
        }
        highlightOn ? enableHighlights() : disableHighlights();
    }

    function toggleAI() {
        if (!AI_ENABLED) {
            if (!HF_KEY) {
                HF_KEY = prompt('♿ AugmentAble: HuggingFace API Key eingeben (wird lokal gespeichert).\nHinweis: Bilder dieser Seite werden zur Beschreibung an HuggingFace übertragen.', '') || '';
                if (!HF_KEY) return;
                GM_setValue('hf_api_key', HF_KEY);
            }
            AI_ENABLED = true;
        } else {
            AI_ENABLED = false;
        }
        GM_setValue('ai_enabled', AI_ENABLED);
        const b = document.getElementById('a11y-ai-btn');
        if (b) { b.textContent = AI_ENABLED ? '🤖 KI-Bildbeschreibung: an' : '🤖 KI-Bildbeschreibung: aus'; b.setAttribute('aria-pressed', String(AI_ENABLED)); }
    }

    // ─── UI PANEL (K10) ────────────────────────────────────────────────────────────────────
    function createPanel() {
        if (!document.body || document.getElementById('a11y-panel')) return;
        const panel = document.createElement('aside');
        panel.id = 'a11y-panel';
        panel.setAttribute('aria-label', 'AugmentAble');
        panel.style.cssText = `
            position:fixed; bottom:15px; right:15px; z-index:2147483647;
            background:#0f172a; color:#f8fafc; font:11px/1.5 sans-serif;
            padding:12px; border-radius:12px; border:1px solid #a855f7;
            box-shadow:0 10px 25px rgba(0,0,0,0.6); min-width:240px;
        `;
        panel.innerHTML = `
            <div style="font-weight:bold;color:#d8b4fe;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <span>♿ AugmentAble</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <span id="a11y-badge" style="background:#3b1a6b;color:#f3e8ff;padding:1px 7px;border-radius:10px;font-size:10px;">0 fixes</span>
                    <button id="a11y-collapse" aria-label="Panel einklappen" aria-expanded="true" style="background:none;border:none;color:#e2e8f0;cursor:pointer;font-size:14px;padding:0;">−</button>
                </div>
            </div>
            <div id="a11y-body">
                <div id="a11y-log" role="log" aria-label="Protokoll" tabindex="0" style="max-height:110px;overflow-y:auto;font-size:10px;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px;"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:10px;">
                    <span>🖼 alt: <b id="s-img">0</b></span>
                    <span>🏷 aria: <b id="s-aria">0</b></span>
                    <span>🎨 contrast: <b id="s-contrast">0</b></span>
                    <span>📋 forms: <b id="s-forms">0</b></span>
                    <span>🔧 misc: <b id="s-misc">0</b></span>
                    <span>🔝 headings: <b id="s-head">0</b></span>
                    <span>🏷 labels: <b id="s-lab">0</b></span>
                </div>
                <button id="a11y-toggle-btn" aria-pressed="false" style="
                    width:100%;padding:6px 0;border-radius:8px;border:none;cursor:pointer;
                    background:#3b1a6b;color:#fff;font-weight:bold;font-size:11px;margin-bottom:4px;
                ">⚪ Outlines OFF</button>
                <button id="a11y-ai-btn" aria-pressed="${AI_ENABLED}" style="
                    width:100%;padding:6px 0;border-radius:8px;border:none;cursor:pointer;
                    background:#1e3a5f;color:#fff;font-weight:bold;font-size:11px;
                ">${AI_ENABLED ? '🤖 KI-Bildbeschreibung: an' : '🤖 KI-Bildbeschreibung: aus'}</button>
                <div id="a11y-issues" role="log" aria-label="Gefundene Probleme" tabindex="0" style="margin-top:8px;max-height:90px;overflow-y:auto;
                    font-size:10px;color:#fecaca;display:none;"></div>
            </div>
        `;
        document.body.appendChild(panel);
        document.getElementById('a11y-toggle-btn').addEventListener('click', toggleHighlight);
        document.getElementById('a11y-ai-btn').addEventListener('click', toggleAI);
        document.getElementById('a11y-collapse').addEventListener('click', function() {
            const body      = document.getElementById('a11y-body');
            const collapsed = body.style.display === 'none';
            body.style.display = collapsed ? '' : 'none';
            this.textContent   = collapsed ? '−' : '+';
            this.setAttribute('aria-expanded', String(collapsed));
        });
    }

    function log(msg, color) {
        const el = document.getElementById('a11y-log');
        if (!el) return;
        const line = document.createElement('div');
        line.style.cssText = `color:${color||'#cbd5e1'};padding:1px 0;border-bottom:1px solid #1e293b;`;
        line.textContent = msg;
        el.insertBefore(line, el.firstChild);
        while (el.children.length > 40) el.removeChild(el.lastChild);
    }

    function updateStat(type, n) {
        stats[type] = (stats[type] || 0) + n;
        const map = { altText:'s-img', ariaLabels:'s-aria', contrast:'s-contrast', forms:'s-forms', misc:'s-misc', headings:'s-head', labels:'s-lab' };
        const el = document.getElementById(map[type]);
        if (el) el.textContent = stats[type];
        const total = Object.values(stats).reduce((a,b) => a+b, 0);
        const badge = document.getElementById('a11y-badge');
        if (badge) badge.textContent = total + ' fixes';
    }

    function logIssue(msg) {
        if (reported.has(msg)) return;
        reported.add(msg);
        const box = document.getElementById('a11y-issues');
        if (!box) return;
        box.style.display = 'block';
        const line = document.createElement('div');
        line.style.cssText = 'border-bottom:1px solid #1e293b;padding:2px 0;';
        line.textContent = msg;
        box.appendChild(line);
    }

    // ─── CONTRAST FIX (K1) ───────────────────────────────────────────────────
    function parseRGBA(str) {
        const m = str && str.match(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?/);
        return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
    }
    function luminance(r, g, b) {
        return [r,g,b].reduce((sum, v, i) => {
            v /= 255;
            v = v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
            return sum + v * [0.2126, 0.7152, 0.0722][i];
        }, 0);
    }
    function contrastRatio(c1, c2) {
        const l1 = luminance(c1[0],c1[1],c1[2]);
        const l2 = luminance(c2[0],c2[1],c2[2]);
        return (Math.max(l1,l2)+0.05) / (Math.min(l1,l2)+0.05);
    }
    const blend = (top, alpha, below) => top.map((v, i) => Math.round(v * alpha + below[i] * (1 - alpha)));

    // Effektiver Hintergrund wie axe: Elternkette hoch, Transparenz mischen; Bild → unbekannt (null)
    function effectiveBackground(el) {
        const layers = [];
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const s = window.getComputedStyle(n);
            if (s.backgroundImage && s.backgroundImage !== 'none') return null;
            const c = parseRGBA(s.backgroundColor);
            if (c && c[3] > 0) {
                layers.push(c);
                if (c[3] >= 1) break;
            }
        }
        let bg = [255, 255, 255];
        for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i].slice(0, 3), layers[i][3], bg);
        return bg;
    }
    function hasOwnText(el) {
        return Array.prototype.some.call(el.childNodes, n => n.nodeType === 3 && n.textContent.trim());
    }
    function adjustColor(fg, bg, target) {
        let best = null;
        for (const pole of [[0,0,0], [255,255,255]]) {
            if (contrastRatio(pole, bg) < target) continue;
            let lo = 0, hi = 1;
            for (let i = 0; i < 24; i++) {
                const m = (lo + hi) / 2;
                const c = fg.map((v, k) => Math.round(v + (pole[k] - v) * m));
                if (contrastRatio(c, bg) >= target) hi = m; else lo = m;
            }
            const c = fg.map((v, k) => Math.round(v + (pole[k] - v) * hi));
            if (contrastRatio(c, bg) >= target && (!best || hi < best.t)) best = { c, t: hi };
        }
        if (best) return best.c;
        return contrastRatio([0,0,0], bg) >= contrastRatio([255,255,255], bg) ? [0,0,0] : [255,255,255];
    }
    function fixContrast() {
        let fixed = 0;
        document.querySelectorAll('p,span,a,li,td,th,label,h1,h2,h3,h4,h5,h6,button,div,dt,dd,strong,em,b,small').forEach(el => {
            if (el.getAttribute('data-a11y-contrast') || isInPanel(el) || !hasOwnText(el)) return;
            const s  = window.getComputedStyle(el);
            if (s.visibility === 'hidden' || s.display === 'none') return;
            const fgA = parseRGBA(s.color);
            const bg  = effectiveBackground(el);
            if (!fgA || !bg) return;
            const fg  = fgA[3] < 1 ? blend(fgA.slice(0, 3), fgA[3], bg) : fgA.slice(0, 3);
            const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight, 10) || 400;
            const isLarge   = size >= 24 || (weight >= 700 && size >= 18.66);
            const threshold = isLarge ? 3.0 : 4.5;
            if (contrastRatio(fg, bg) >= threshold) return;
            const c = adjustColor(fg, bg, threshold + 0.05);
            if (c.join() === fg.join()) return;
            el.style.setProperty('color', `rgb(${c[0]},${c[1]},${c[2]})`, 'important');
            el.setAttribute('data-a11y-contrast', '1');
            fixed++;
        });
        if (fixed > 0) { updateStat('contrast', fixed); log(`🎨 ${fixed} contrast issues fixed`, '#fde68a'); }
    }

    // ─── ARIA FIX (K3, K4, K5, K6) ───────────────────────────────────────────
    // Eindeutige Icon-Klassen → Name (nur ganze Wörter, genau ein Treffer)
    const ICON_WORDS = { close:'Close', menu:'Menu', search:'Search', play:'Play', pause:'Pause', next:'Next', prev:'Previous',
        previous:'Previous', share:'Share', download:'Download', upload:'Upload', settings:'Settings', help:'Help', delete:'Delete', edit:'Edit' };
    function classGuess(el) {
        const words = ((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '')
            .toString().toLowerCase().split(/[^a-z]+/).filter(w => ICON_WORDS[w]);
        const uniq = Array.from(new Set(words.map(w => ICON_WORDS[w])));
        return uniq.length === 1 ? uniq[0] : null;
    }

    function fixAriaLabels() {
        let fixed = 0;
        document.querySelectorAll('button, [role="button"], a[href], [role="link"]').forEach(el => {
            if (isInPanel(el) || el.id === 'a11y-skip' || el.getAttribute('data-a11y-aria') || el.getAttribute('data-a11y-label')) return;
            if (hasAccessibleName(el)) return;
            const svgTitle = el.querySelector('svg title');
            const guess    = classGuess(el);
            if (svgTitle && textOf(svgTitle))  { setName(el, textOf(svgTitle), 'svg-title', 'data-a11y-aria'); fixed++; }
            else if (guess)                    { setName(el, guess, 'klasse', 'data-a11y-aria'); fixed++; }
            else {
                // Kein verlässlicher Name → nichts erfinden, nur melden (K3)
                el.setAttribute('data-a11y-label', el.tagName === 'A' ? 'link-ohne-namen' : 'button-ohne-namen');
                logIssue(`🏷 ${el.tagName === 'A' ? 'Link' : 'Button'} ohne Namen (keine verlässliche Quelle)`);
                updateStat('labels', 1);
            }
        });
        // SVGs: nur rein grafische verstecken, interaktive/textuelle in Ruhe lassen (K6)
        document.querySelectorAll('svg:not([aria-label]):not([aria-labelledby]):not([aria-hidden]):not([role]):not([data-a11y-aria])').forEach(svg => {
            if (isInPanel(svg)) return;
            const title = svg.querySelector('title');
            if (title && textOf(title)) {
                const inNamedControl = svg.parentElement && svg.parentElement.closest('button, a[href], [role="button"], [role="link"]');
                if (inNamedControl) return; // Name des Buttons/Links kommt bereits aus dem title
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', textOf(title));
                svg.setAttribute('data-a11y-src', 'svg-title');
                svg.setAttribute('data-a11y-aria', '1');
                fixed++;
                return;
            }
            if (svg.querySelector('a, [tabindex], text, foreignObject')) return;
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('data-a11y-aria', '1');
            fixed++;
        });
        if (fixed > 0) { updateStat('ariaLabels', fixed); log(`🏷 ${fixed} ARIA labels added`, '#7dd3fc'); }
    }

    // ─── FORM FIX (K3, K4, K8) ───────────────────────────────────────────────
    // Sichtbarer Text direkt vor dem Feld im selben Elternelement ("E-Mail: <input>")
    function neighbourText(el) {
        let n = el.previousSibling;
        // Leerraum und Kommentare überspringen
        while (n && (n.nodeType === 8 || (n.nodeType === 3 && !n.textContent.trim()))) n = n.previousSibling;
        if (!n) return null;
        if (n.nodeType === 1) {
            // nur kurze Inline-Elemente; kein Label, das zu einem anderen Feld gehört
            if (!n.matches('span,b,strong,em,i,small,label')) return null;
            if (n.tagName === 'LABEL' && n.htmlFor && n.htmlFor !== el.id) return null;
            if (n.querySelector('input,select,textarea,button')) return null;
        } else if (n.nodeType !== 3) return null;
        const t = norm(n.textContent).replace(/[:*]\s*$/, '');
        return t && t.length <= 60 ? t : null;
    }
    function fixForms() {
        let fixed = 0;
        document.querySelectorAll('input,select,textarea').forEach(el => {
            if (el.getAttribute('data-a11y-form') || el.getAttribute('data-a11y-label') || isInPanel(el)) return;
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (type === 'hidden') return;
            if (hasAccessibleName(el)) return;
            const ph = norm(el.getAttribute('placeholder'));
            const nb = neighbourText(el);
            if (ph)      { setName(el, ph, 'placeholder', 'data-a11y-form'); fixed++; }
            else if (nb) { setName(el, nb, 'nachbartext', 'data-a11y-form'); fixed++; }
            else {
                el.setAttribute('data-a11y-label', 'feld-ohne-label');
                logIssue(`📋 ${el.tagName.toLowerCase()}${type ? '[' + type + ']' : ''} ohne Label (keine verlässliche Quelle)`);
                updateStat('labels', 1);
            }
        });
        if (fixed > 0) { updateStat('forms', fixed); log(`📋 ${fixed} form labels added`, '#d8b4fe'); }
    }

    // ─── SPRACHE (K7) ────────────────────────────────────────────────────────────────────────
    const STOPWORDS = {
        en: 'the and of to is in that for with you this are was on as be it',
        de: 'der die und das ist nicht mit ein eine sie für auf den zu von im sich des',
        fr: 'le la les et est des une pour dans que qui pas sur au du ce il',
        es: 'el la los las y que en por para una con es del se lo al',
        it: 'il di che la per non una con sono gli del della le è un',
        nl: 'het een en van is niet dat op voor met zijn te er ook',
        pt: 'o os que do da em um para com não uma as dos no'
    };
    function detectLanguage() {
        const meta = document.querySelector('meta[http-equiv="content-language" i]');
        if (meta && norm(meta.content)) return norm(meta.content).split(/[,;]/)[0].split(/[-_]/)[0].toLowerCase();
        const og = document.querySelector('meta[property="og:locale"]');
        if (og && /^[a-z]{2}([_-][A-Za-z]{2})?$/.test(norm(og.content))) return norm(og.content).slice(0, 2).toLowerCase();
        const words = ((document.body && document.body.innerText) || '').toLowerCase().slice(0, 8000).match(/[\p{L}]+/gu) || [];
        if (words.length < 40) return null;
        const scores = Object.entries(STOPWORDS).map(([lang, list]) => {
            const set = new Set(list.split(' '));
            return [lang, words.filter(w => set.has(w)).length / words.length];
        }).sort((a, b) => b[1] - a[1]);
        const [best, second] = scores;
        return best[1] >= 0.06 && best[1] >= 1.5 * second[1] ? best[0] : null;
    }

    // ─── LANDMARKS & MISC ────────────────────────────────────────────────────
    function fixLandmarks() {
        let fixed = 0;
        if (!document.documentElement.getAttribute('lang')) {
            const lang = detectLanguage();
            if (lang) {
                document.documentElement.setAttribute('lang', lang);
                document.documentElement.setAttribute('data-a11y-lang', 'erkannt');
                fixed++; log(`🌐 lang="${lang}" gesetzt (erkannt)`, '#ddd6fe');
            } else {
                logIssue('🌐 Seite ohne lang – Sprache nicht sicher erkennbar, nichts gesetzt');
            }
        }
        if (!document.getElementById('a11y-skip')) {
            const main = document.querySelector('main,[role="main"],#main,#content,.main');
            const existing = Array.prototype.slice.call(document.querySelectorAll('a[href^="#"]'), 0, 5)
                .some(a => /skip|springen|zum inhalt|main content|hauptinhalt/i.test(a.textContent));
            if (main && !existing) {
                if (!main.id) main.id = 'a11y-main-content';
                const skip = document.createElement('a');
                skip.id = 'a11y-skip';
                skip.href = '#' + main.id;
                skip.textContent = 'Skip to main content';
                skip.style.cssText = 'position:absolute;top:-40px;left:0;z-index:2147483646;background:#000;color:#fff;padding:8px 16px;font:bold 14px sans-serif;text-decoration:none;border-radius:0 0 4px 0;transition:top 0.2s';
                skip.addEventListener('focus', () => skip.style.top = '0');
                skip.addEventListener('blur',  () => skip.style.top = '-40px');
                document.body.insertBefore(skip, document.body.firstChild);
                fixed++; log('⏭ Skip-to-content added', '#ddd6fe');
            }
        }
        if (!document.getElementById('a11y-focus-style')) {
            const style = document.createElement('style');
            style.id = 'a11y-focus-style';
            style.textContent = `
                *:focus-visible { outline: 3px solid #a855f7 !important; outline-offset: 2px !important; }
                @media (prefers-reduced-motion: reduce) {
                    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
                }
            `;
            document.head.appendChild(style);
            fixed++; log('🔵 Focus indicators set', '#ddd6fe');
        }
        // nav-Namen nur, wenn es mehrere unbenannte nav gibt (landmark-unique)
        const navs = Array.prototype.filter.call(document.querySelectorAll('nav'), n => !isInPanel(n) && !hasAccessibleName(n) && !n.getAttribute('data-a11y-misc'));
        if (navs.length > 1) navs.forEach((nav, i) => {
            nav.setAttribute('aria-label', i === 0 ? 'Main navigation' : `Navigation ${i+1}`);
            nav.setAttribute('data-a11y-misc','1'); fixed++;
        });
        document.querySelectorAll('video[autoplay]:not([data-a11y-misc])').forEach(v => {
            v.muted = true;
            v.setAttribute('controls','');
            v.setAttribute('data-a11y-misc','1'); fixed++;
        });
        document.querySelectorAll('[tabindex]').forEach(el => {
            if (el.getAttribute('data-a11y-misc') || isInPanel(el)) return;
            if (parseInt(el.getAttribute('tabindex'), 10) > 0) {
                el.setAttribute('tabindex','0');
                el.setAttribute('data-a11y-misc','1'); fixed++;
            }
        });
        if (fixed > 0) updateStat('misc', fixed);
    }

    // ─── HEADING CHECK (K2: nur melden, nichts in title schreiben) ───────────
    function checkHeadings() {
        if (document.body.getAttribute('data-a11y-headings-done')) return;
        document.body.setAttribute('data-a11y-headings-done','1');
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h => !isInPanel(h));
        const h1s = headings.filter(h => h.tagName === 'H1');
        if (h1s.length === 0) logIssue('⚠ No H1 on this page');
        else if (h1s.length > 1) logIssue(`⚠ ${h1s.length}× H1 found (multiple H1s)`);
        let prevLevel = 0;
        headings.forEach(h => {
            const level = parseInt(h.tagName[1], 10);
            const text  = textOf(h);
            let problem = '';
            if (!text) problem = `Empty ${h.tagName}`;
            else if (prevLevel > 0 && level > prevLevel + 1) problem = `${h.tagName} jumps H${prevLevel}→H${level}: "${text.substring(0,30)}"`;
            if (problem) {
                h.setAttribute('data-a11y-heading', problem);
                logIssue('🔝 ' + problem);
                updateStat('headings', 1);
            }
            if (text) prevLevel = level;
        });
    }

    // ─── AI IMAGE ANALYSIS (K9) ───────────────────────────────────────────────
    function showOverlay(img, text, color) {
        const parent = img.parentElement;
        if (!parent) return;
        const old = parent.querySelector('.ai-overlay');
        if (old) old.remove();
        const div = document.createElement('div');
        div.className = 'ai-overlay';
        div.setAttribute('aria-hidden', 'true');
        div.style.cssText = `display:none;position:absolute;bottom:0;left:0;right:0;background:${color||'rgba(0,70,0,0.92)'};color:#fff;font-size:11px;font-family:sans-serif;padding:3px 6px;pointer-events:none;z-index:99999;word-break:break-word;line-height:1.4`;
        div.textContent = text;
        if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        parent.appendChild(div);
    }

    const LANG_NAMES = { en:'English', de:'German', fr:'French', es:'Spanish', it:'Italian', nl:'Dutch', pt:'Portuguese', pl:'Polish', sv:'Swedish', da:'Danish', fi:'Finnish', cs:'Czech', tr:'Turkish', ja:'Japanese', zh:'Chinese', ko:'Korean', ru:'Russian', ar:'Arabic' };
    function imageContext(img) {
        const fig = img.closest('figure');
        const cap = fig && fig.querySelector('figcaption');
        if (cap && textOf(cap)) return textOf(cap).slice(0, 200);
        let n = img;
        while (n && n !== document.body) {
            let p = n.previousElementSibling;
            while (p) {
                if (/^H[1-6]$/.test(p.tagName) && textOf(p)) return textOf(p).slice(0, 200);
                const h = p.querySelector && p.querySelector('h1,h2,h3,h4,h5,h6');
                if (h && textOf(h)) return textOf(h).slice(0, 200);
                p = p.previousElementSibling;
            }
            n = n.parentElement;
        }
        return document.title.slice(0, 200);
    }

    function sendToHF(imageUrl, img) {
        if (!HF_KEY || !AI_ENABLED) return;
        const model = MODELS[modelIndex];
        const langCode = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2).toLowerCase();
        const langName = LANG_NAMES[langCode] || 'English';
        const context  = imageContext(img);
        GM_xmlhttpRequest({
            method: 'POST',
            url: API_URL,
            headers: { 'Authorization': `Bearer ${HF_KEY}`, 'Content-Type': 'application/json' },
            data: JSON.stringify({
                model: model,
                messages: [{ role:'user', content:[
                    { type:'image_url', image_url:{ url: imageUrl } },
                    { type:'text', text:`Write alt text for this image for a screen reader user, in ${langName}. One concise sentence, at most 125 characters. Describe what matters for the image's purpose on the page. Do not start with "Image of" or "Picture of". Context on the page: "${context}"` }
                ]}],
                max_tokens: 120
            }),
            onload: (res) => {
                try {
                    const data = JSON.parse(res.responseText);
                    if (res.status === 200) {
                        const desc = norm(data.choices[0].message.content).replace(/^["'„“]+|["'“”]+$/g, '').slice(0, 200);
                        img.setAttribute('alt', desc);
                        img.setAttribute('data-ai-done','done');
                        img.setAttribute('data-ai-model', model);
                        showOverlay(img, '🤖 ' + desc);
                        updateStat('altText', 1);
                        log('🖼 ' + desc.substring(0,55) + '…', '#7ec8e3');
                    } else if (res.status === 401 || res.status === 402 || res.status === 403) {
                        // Konto-Problem: weitere Modelle helfen nicht, nichts mehr senden
                        aiBlocked = true;
                        img.setAttribute('data-ai-done','failed');
                        logIssue(res.status === 402 ? '🤖 HuggingFace: kein Guthaben mehr – KI pausiert' : '🤖 HuggingFace-Key ungültig oder ohne Berechtigung – KI pausiert');
                    } else if ([400, 404, 422, 429, 500, 502, 503].includes(res.status) && modelIndex < MODELS.length - 1) {
                        // Modell nicht (mehr) verfügbar oder überlastet → nächstes Modell der Kette
                        modelIndex++;
                        img.setAttribute('data-ai-done','');
                        setTimeout(() => processImage(img), 1500);
                    } else {
                        img.setAttribute('data-ai-done','failed');
                        console.warn('HF error:', data.error || res.responseText);
                    }
                } catch(e) { img.setAttribute('data-ai-done','failed'); }
            },
            onerror: () => img.setAttribute('data-ai-done','failed')
        });
    }

    function processImage(img) {
        img.setAttribute('data-ai-done','trying');
        showOverlay(img, '⏳ Analyzing...', 'rgba(80,80,0,0.92)');
        const src = img.currentSrc || img.src;
        const tmp = new Image();
        tmp.crossOrigin = 'anonymous';
        const viaUrl = () => {
            // Canvas nicht lesbar (CORS) → öffentliche URL direkt senden
            if (/^https:\/\//.test(src)) { img.setAttribute('data-ai-via', 'url'); sendToHF(src, img); }
            else img.setAttribute('data-ai-done','failed');
        };
        tmp.onload = function() {
            try {
                const c     = document.createElement('canvas');
                const scale = Math.min(1, 512 / Math.max(tmp.naturalWidth||1, tmp.naturalHeight||1));
                c.width  = Math.round((tmp.naturalWidth  || 300) * scale);
                c.height = Math.round((tmp.naturalHeight || 300) * scale);
                c.getContext('2d').drawImage(tmp, 0, 0, c.width, c.height);
                const dataUrl = c.toDataURL('image/jpeg', 0.8);
                if (dataUrl.indexOf('data:image/jpeg') === 0 && dataUrl.length > 100) { img.setAttribute('data-ai-via', 'canvas'); sendToHF(dataUrl, img); }
                else viaUrl();
            } catch(e) { viaUrl(); }
        };
        tmp.onerror = viaUrl;
        tmp.src = src;
    }

    const MEANINGLESS_ALT = /^(image|img|photo|foto|bild|picture|pic|graphic|grafik|logo|icon|banner)?[\s_-]*\d*$/i;
    function needsDescription(i) {
        if (!i.hasAttribute('alt')) return true;
        const alt = norm(i.getAttribute('alt'));
        if (alt === '') return false;                                  // bewusst dekorativ
        const file = (i.src || '').split(/[?#]/)[0].split('/').pop();
        return alt === i.src || alt === file || /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(alt) || MEANINGLESS_ALT.test(alt);
    }
    function markDecorativeImages() {
        // Bilder in Links/Buttons, die bereits einen Textnamen haben, sind dekorativ → alt=""
        document.querySelectorAll('a[href] img:not([alt]), button img:not([alt])').forEach(img => {
            if (isInPanel(img)) return;
            const ctl = img.closest('a[href], button');
            if (ctl && textOf(ctl)) { img.setAttribute('alt', ''); img.setAttribute('data-a11y-src', 'dekorativ'); img.setAttribute('data-a11y-aria', '1'); }
        });
    }

    function processNextImage() {
        if (!HF_KEY || !AI_ENABLED || aiBlocked) return;
        const img = Array.from(document.querySelectorAll('img')).find(i =>
            i.width > 100 && i.height > 50
            && needsDescription(i)
            && !i.getAttribute('data-ai-done')
            && !isInPanel(i)
            && (i.currentSrc || i.src)
            && !(i.src || '').startsWith('data:image/gif')
            && !(i.src || '').startsWith('data:image/svg')
            && i.naturalWidth > 50
        );
        if (img) processImage(img);
    }

    // ─── MUTATION OBSERVER ───────────────────────────────────────────────────
    let mutationTimer = null;
    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => Array.prototype.some.call(m.addedNodes, n => !(n.nodeType === 1 && (n.id === 'a11y-panel' || n.className === 'ai-overlay' || isInPanel(n)))))) {
            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(runAllFixes, 800);
        }
    });

    function runAllFixes() {
        safe('Kontrast', fixContrast);
        safe('ARIA', fixAriaLabels);
        safe('Formulare', fixForms);
        safe('Landmarks', fixLandmarks);
        safe('Überschriften', checkHeadings);
        safe('Dekorative Bilder', markDecorativeImages);
    }

    function init() {
        safe('Panel', createPanel);
        runAllFixes();
        observer.observe(document.body, { childList:true, subtree:true });
        setInterval(processNextImage, 6000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
