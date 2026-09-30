// ==UserScript==
// @name         AugmentAbleDemo
// @namespace    http://tampermonkey.net/
// @version      140.0
// @description  AI Image Description, Contrast, ARIA, Forms, Landmarks, Heading Check & Focus Enforcer
// @author       Your Name / Research Group
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      router.huggingface.co
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // SECURE KEY HANDLING: Prompt and save to local storage (Tampermonkey)
    let HF_KEY = GM_getValue('hf_api_key', '');

    if (!HF_KEY || HF_KEY === 'your_key_here') {
        HF_KEY = prompt('♿ AugmentAble: Please enter your HuggingFace API Key (will be saved locally):', '');
        if (HF_KEY) {
            GM_setValue('hf_api_key', HF_KEY);
        } else {
            console.warn('AugmentAble: No API Key provided. AI features will be disabled.');
        }
    }

    const API_URL = 'https://router.huggingface.co/v1/chat/completions';
    const MODELS  = [
        'CohereLabs/aya-vision-32b:cohere',
        'Qwen/Qwen2.5-VL-7B-Instruct:nebius',
        'Qwen/Qwen2-VL-7B-Instruct:fastest'
    ];
    let modelIndex  = 0;
    let highlightOn = false;
    let stats       = { altText:0, ariaLabels:0, contrast:0, forms:0, misc:0, headings:0, labels:0 };

    // ─── HIGHLIGHT: Pure Stylesheet using data-attributes ─────────────────────
    function getHighlightStyle() {
        return document.getElementById('a11y-hl-style');
    }

    function enableHighlights() {
        if (getHighlightStyle()) return;
        const s = document.createElement('style');
        s.id = 'a11y-hl-style';
        s.textContent = `
            [data-ai-done="done"],
            [data-a11y-aria="1"],
            [data-a11y-form="1"],
            [data-a11y-contrast="1"],
            [data-a11y-heading],
            [data-a11y-label] {
                outline: 6px solid #a855f7 !important;
                outline-offset: 4px !important;
                box-shadow: 0 0 0 9px rgba(168,85,247,0.30), 0 0 16px 4px rgba(168,85,247,0.45) !important;
            }
        `;
        document.head.appendChild(s);
    }

    function disableHighlights() {
        const s = getHighlightStyle();
        if (s) s.remove();
    }

    function toggleHighlight() {
        highlightOn = !highlightOn;
        const btn = document.getElementById('a11y-toggle-btn');
        if (btn) {
            btn.textContent      = highlightOn ? '🟢 Outlines ON' : '⚪ Outlines OFF';
            btn.style.background = highlightOn ? '#15803d' : '#1e3a5f';
        }
        highlightOn ? enableHighlights() : disableHighlights();
    }

    // ─── UI PANEL ──────────────────────────────────────────────────────────────────────────
    function createPanel() {
        if (!document.body || document.getElementById('a11y-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'a11y-panel';
        panel.style.cssText = `
            position:fixed; bottom:15px; right:15px; z-index:2147483647;
            background:#0f172a; color:#f8fafc; font:11px/1.5 sans-serif;
            padding:12px; border-radius:12px; border:1px solid #a855f7;
            box-shadow:0 10px 25px rgba(0,0,0,0.6); min-width:240px;
        `;
        panel.innerHTML = `
            <div style="font-weight:bold;color:#a855f7;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <span>♿ AugmentAble</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <span id="a11y-badge" style="background:#3b1a6b;color:#d8b4fe;padding:1px 7px;border-radius:10px;font-size:10px;">0 fixes</span>
                    <button id="a11y-collapse" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;padding:0;">−</button>
                </div>
            </div>
            <div id="a11y-body">
                <div id="a11y-log" style="max-height:110px;overflow-y:auto;font-size:10px;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px;"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:10px;">
                    <span>🖼 alt: <b id="s-img">0</b></span>
                    <span>🏷 aria: <b id="s-aria">0</b></span>
                    <span>🎨 contrast: <b id="s-contrast">0</b></span>
                    <span>📋 forms: <b id="s-forms">0</b></span>
                    <span>🔧 misc: <b id="s-misc">0</b></span>
                    <span>🔝 headings: <b id="s-head">0</b></span>
                    <span>🏷 labels: <b id="s-lab">0</b></span>
                </div>
                <div style="font-size:9px;color:#475569;margin-bottom:8px;line-height:1.8;">
                    🟢 AI image &nbsp;|&nbsp; 🔵 ARIA fix &nbsp;|&nbsp; 🟣 Form fix<br>
                    🟨 Contrast &nbsp;|&nbsp; 🟡 Heading &nbsp;|&nbsp; 🔴 Label missing
                </div>
                <button id="a11y-toggle-btn" style="
                    width:100%;padding:6px 0;border-radius:8px;border:none;cursor:pointer;
                    background:#3b1a6b;color:#fff;font-weight:bold;font-size:11px;
                ">⚪ Outlines OFF</button>
                <div id="a11y-issues" style="margin-top:8px;max-height:90px;overflow-y:auto;
                    font-size:10px;color:#fca5a5;display:none;"></div>
            </div>
        `;
        document.body.appendChild(panel);
        document.getElementById('a11y-toggle-btn').addEventListener('click', toggleHighlight);
        document.getElementById('a11y-collapse').addEventListener('click', function() {
            const body      = document.getElementById('a11y-body');
            const collapsed = body.style.display === 'none';
            body.style.display = collapsed ? '' : 'none';
            this.textContent   = collapsed ? '−' : '+';
        });
    }

    function log(msg, color) {
        const el = document.getElementById('a11y-log');
        if (!el) return;
        const line = document.createElement('div');
        line.style.cssText = `color:${color||'#94a3b8'};padding:1px 0;border-bottom:1px solid #1e293b;`;
        line.textContent = msg;
        el.insertBefore(line, el.firstChild);
        while (el.children.length > 40) el.removeChild(el.lastChild);
    }

    function updateStat(type, n) {
        stats[type] = (stats[type] || 0) + n;
        const map = {
            altText:'s-img', ariaLabels:'s-aria', contrast:'s-contrast',
            forms:'s-forms', misc:'s-misc', headings:'s-head', labels:'s-lab'
        };
        const el = document.getElementById(map[type]);
        if (el) el.textContent = stats[type];
        const total = Object.values(stats).reduce((a,b) => a+b, 0);
        const badge = document.getElementById('a11y-badge');
        if (badge) badge.textContent = total + ' fixes';
    }

    function logIssue(msg) {
        const box = document.getElementById('a11y-issues');
        if (!box) return;
        box.style.display = 'block';
        const line = document.createElement('div');
        line.style.cssText = 'border-bottom:1px solid #1e293b;padding:2px 0;';
        line.textContent = msg;
        box.appendChild(line);
        box.scrollTop = box.scrollHeight;
    }

    // ─── CONTRAST FIX ────────────────────────────────────────────────────────────────────────────
    function parseColor(str) {
        if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? [+m[1], +m[2], +m[3]] : null;
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
    function fixContrast() {
        let fixed = 0;
        document.querySelectorAll('p,span,a,li,td,th,label,h1,h2,h3,h4,h5,h6,button').forEach(el => {
            if (el.getAttribute('data-a11y-contrast')) return;
            const s   = window.getComputedStyle(el);
            const fg  = parseColor(s.color);
            const bg  = parseColor(s.backgroundColor);
            if (!fg || !bg) return;
            const isLarge   = parseFloat(s.fontSize) >= 24 || (parseInt(s.fontWeight) >= 700 && parseFloat(s.fontSize) >= 18.66);
            const threshold = isLarge ? 3.0 : 4.5;
            if (contrastRatio(fg, bg) < threshold) {
                let [r,g,b] = fg;
                for (let i = 0; i < 25; i++) {
                    r=Math.max(0,r-10); g=Math.max(0,g-10); b=Math.max(0,b-10);
                    if (contrastRatio([r,g,b], bg) >= threshold) break;
                }
                el.style.color = `rgb(${r},${g},${b})`;
                el.setAttribute('data-a11y-contrast','1');
                fixed++;
            }
        });
        if (fixed > 0) { updateStat('contrast', fixed); log(`🎨 ${fixed} contrast issues fixed`, '#fde68a'); }
    }

    // ─── ARIA FIX ─────────────────────────────────────────────────────────────────────────────
    function fixAriaLabels() {
        let fixed = 0;
        document.querySelectorAll('button:not([aria-label]):not([aria-labelledby])').forEach(btn => {
            if (btn.getAttribute('data-a11y-aria') || btn.textContent.trim()) return;
            const svgTitle = btn.querySelector('title');
            const cls      = (btn.className || '').toString();
            const match    = cls.match(/(close|menu|search|back|next|prev|play|pause|stop|share|like|edit|delete|add|remove|open|expand|collapse|download|upload|settings|info|help)/i);
            btn.setAttribute('aria-label', svgTitle ? svgTitle.textContent.trim() : match ? match[1] : 'Button');
            btn.setAttribute('data-a11y-aria','1');
            fixed++;
        });
        document.querySelectorAll('a:not([aria-label]):not([aria-labelledby])').forEach(a => {
            if (a.getAttribute('data-a11y-aria') || a.textContent.trim()) return;
            const img = a.querySelector('img[alt]');
            a.setAttribute('aria-label', (img ? img.alt : (a.title || a.href || 'Link')).substring(0,80));
            a.setAttribute('data-a11y-aria','1');
            fixed++;
        });
        document.querySelectorAll('svg:not([aria-label]):not([aria-hidden]):not([data-a11y-aria])').forEach(svg => {
            const title = svg.querySelector('title');
            if (title) { svg.setAttribute('aria-label', title.textContent); svg.setAttribute('role','img'); }
            else svg.setAttribute('aria-hidden','true');
            svg.setAttribute('data-a11y-aria','1');
            fixed++;
        });
        if (fixed > 0) { updateStat('ariaLabels', fixed); log(`🏷 ${fixed} ARIA labels added`, '#38bdf8'); }
    }

    // ─── FORM FIX ───────────────────────────────────────────────────────────────────────
    function fixForms() {
        let fixed = 0;
        document.querySelectorAll('input,select,textarea').forEach(el => {
            if (el.getAttribute('data-a11y-form')) return;
            if (['hidden','submit','button','reset'].includes(el.type)) return;
            const hasLabel = el.id && document.querySelector(`label[for="${el.id}"]`);
            if (hasLabel || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
            const hint = el.placeholder || el.name || el.type || 'Field';
            el.setAttribute('aria-label', hint.charAt(0).toUpperCase() + hint.slice(1).replace(/[-_]/g,' '));
            el.setAttribute('data-a11y-form','1');
            fixed++;
        });
        if (fixed > 0) { updateStat('forms', fixed); log(`📋 ${fixed} form labels added`, '#c084fc'); }
    }

    // ─── LANDMARKS & MISC ────────────────────────────────────────────────────
    function fixLandmarks() {
        let fixed = 0;
        if (!document.documentElement.lang) {
            document.documentElement.lang = 'en';
            fixed++; log('🌐 lang="en" set', '#c9b1ff');
        }
        if (!document.getElementById('a11y-skip')) {
            const main = document.querySelector('main,[role="main"],#main,#content,.main');
            if (main) {
                if (!main.id) main.id = 'a11y-main-content';
                const skip = document.createElement('a');
                skip.id = 'a11y-skip';
                skip.href = '#' + main.id;
                skip.textContent = 'Skip to main content';
                skip.style.cssText = 'position:absolute;top:-40px;left:0;z-index:2147483646;background:#000;color:#fff;padding:8px 16px;font:bold 14px sans-serif;text-decoration:none;border-radius:0 0 4px 0;transition:top 0.2s';
                skip.addEventListener('focus', () => skip.style.top = '0');
                skip.addEventListener('blur',  () => skip.style.top = '-40px');
                document.body.insertBefore(skip, document.body.firstChild);
                fixed++; log('⏭ Skip-to-content added', '#c9b1ff');
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
            fixed++; log('🔵 Focus indicators set', '#c9b1ff');
        }
        document.querySelectorAll('nav:not([aria-label]):not([data-a11y-misc])').forEach((nav, i) => {
            nav.setAttribute('aria-label', i === 0 ? 'Main navigation' : `Navigation ${i+1}`);
            nav.setAttribute('data-a11y-misc','1'); fixed++;
        });
        document.querySelectorAll('video[autoplay]:not([data-a11y-misc])').forEach(v => {
            v.muted = true;
            v.setAttribute('controls','');
            v.setAttribute('data-a11y-misc','1'); fixed++;
        });
        document.querySelectorAll('[tabindex]').forEach(el => {
            if (el.getAttribute('data-a11y-misc')) return;
            if (parseInt(el.getAttribute('tabindex')) > 0) {
                el.setAttribute('tabindex','0');
                el.setAttribute('data-a11y-misc','1'); fixed++;
            }
        });
        if (fixed > 0) updateStat('misc', fixed);
    }

    // ─── HEADING CHECK ─────────────────────────────────────────────────
    function checkHeadings() {
        if (document.body.getAttribute('data-a11y-headings-done')) return;
        document.body.setAttribute('data-a11y-headings-done','1');
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
        const h1s = headings.filter(h => h.tagName === 'H1');
        if (h1s.length === 0) logIssue('⚠ No H1 on this page');
        else if (h1s.length > 1) logIssue(`⚠ ${h1s.length}× H1 found (multiple H1s)`);
        let prevLevel = 0;
        headings.forEach(h => {
            const level = parseInt(h.tagName[1]);
            const text  = h.textContent.trim();
            let problem = '';
            if (!text) {
                problem = `Empty ${h.tagName}`;
            } else if (prevLevel > 0 && level > prevLevel + 1) {
                problem = `${h.tagName} jumps H${prevLevel}→H${level}: "${text.substring(0,30)}"`;
            }
            if (problem) {
                h.setAttribute('data-a11y-heading','⚠ ' + problem);
                h.title = '⚠ ' + problem;
                logIssue('🔝 ' + problem);
                updateStat('headings', 1);
            }
            if (text) prevLevel = level;
        });
    }

    // ─── LABEL CHECK ─────────────────────────────────────────────────────────────────────
    function checkLabels() {
        if (document.body.getAttribute('data-a11y-labels-done')) return;
        document.body.setAttribute('data-a11y-labels-done','1');
        document.querySelectorAll('input:not([type=hidden]),select,textarea,button').forEach(el => {
            const hasLabel   = el.id && document.querySelector(`label[for="${el.id}"]`);
            const hasAria    = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
            const hasTitle   = el.title;
            const isBtn      = el.tagName === 'BUTTON';
            const btnHasText = isBtn && el.textContent.trim();
            if (!hasLabel && !hasAria && !hasTitle && !btnHasText) {
                const desc = `${el.tagName.toLowerCase()}${el.type ? '['+el.type+']' : ''} without label`;
                el.setAttribute('data-a11y-label','⚠ ' + desc);
                el.title = '⚠ ' + desc;
                logIssue('🏷 ' + desc);
                updateStat('labels', 1);
            }
        });
    }

    // ─── AI IMAGE ANALYSIS ─────────────────────────────────────────────────────
    function showOverlay(img, text, color) {
        const old = img.parentElement && img.parentElement.querySelector('.ai-overlay');
        if (old) old.remove();
        const div = document.createElement('div');
        div.className = 'ai-overlay';
        div.style.cssText = `position:absolute;bottom:0;left:0;right:0;background:${color||'rgba(0,90,0,0.88)'};color:#fff;font-size:11px;font-family:sans-serif;padding:3px 6px;pointer-events:none;z-index:99999;word-break:break-word;line-height:1.4`;
        div.textContent = text;
        const parent = img.parentElement;
        if (parent) {
            if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
            parent.appendChild(div);
        }
    }

    function sendToHF(dataUrl, img) {
        if (!HF_KEY) return;
        const model = MODELS[modelIndex];
        GM_xmlhttpRequest({
            method: 'POST',
            url: API_URL,
            headers: { 'Authorization': `Bearer ${HF_KEY}`, 'Content-Type': 'application/json' },
            data: JSON.stringify({
                model: model,
                messages: [{ role:'user', content:[
                    { type:'image_url', image_url:{ url: dataUrl } },
                    { type:'text', text:'Describe this image in one concise sentence for a screen reader. Be specific about what you see.' }
                ]}],
                max_tokens: 120
            }),
            onload: (res) => {
                try {
                    const data = JSON.parse(res.responseText);
                    if (res.status === 200) {
                        const desc = data.choices[0].message.content.trim();
                        img.setAttribute('alt', desc);
                        img.setAttribute('data-ai-done','done');
                        showOverlay(img, '🤖 ' + desc, 'rgba(0,90,0,0.88)');
                        updateStat('altText', 1);
                        log('🖼 ' + desc.substring(0,55) + '…', '#7ec8e3');
                    } else if (data.error && data.error.code === 'model_not_supported') {
                        modelIndex = (modelIndex + 1) % MODELS.length;
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
        showOverlay(img, '⏳ Analyzing...', 'rgba(80,80,0,0.85)');
        const tmp = new Image();
        tmp.crossOrigin = 'anonymous';
        tmp.onload = function() {
            try {
                const c     = document.createElement('canvas');
                const scale = Math.min(1, 512 / Math.max(tmp.naturalWidth||1, tmp.naturalHeight||1));
                c.width  = Math.round((tmp.naturalWidth  || 300) * scale);
                c.height = Math.round((tmp.naturalHeight || 300) * scale);
                c.getContext('2d').drawImage(tmp, 0, 0, c.width, c.height);
                const dataUrl = c.toDataURL('image/jpeg', 0.8);
                if (dataUrl.indexOf('data:image/jpeg') === 0 && dataUrl.length > 100) {
                    sendToHF(dataUrl, img);
                } else {
                    img.setAttribute('data-ai-done','failed');
                }
            } catch(e) {
                img.setAttribute('data-ai-done','failed');
            }
        };
        tmp.onerror = () => img.setAttribute('data-ai-done','failed');
        tmp.src = img.src;
    }

    function processNextImage() {
        if (!HF_KEY) return;
        const img = Array.from(document.querySelectorAll('img')).find(i =>
            i.width > 100 && i.height > 50
            && (!i.alt || i.alt.trim() === '' || i.alt === i.src || i.alt === 'image')
            && !i.getAttribute('data-ai-done')
            && i.src
            && !i.src.startsWith('data:image/gif')
            && !i.src.startsWith('data:image/svg')
            && i.naturalWidth > 50
        );
        if (img) processImage(img);
    }

    // ─── MUTATION OBSERVER ───────────────────────────────────────────────────
    let mutationTimer = null;
    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes.length > 0)) {
            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(runAllFixes, 800);
        }
    });

    function runAllFixes() {
        fixContrast();
        fixAriaLabels();
        fixForms();
        fixLandmarks();
        checkHeadings();
        checkLabels();
    }

    function init() {
        createPanel();
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
