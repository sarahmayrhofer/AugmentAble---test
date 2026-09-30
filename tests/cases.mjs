// Ein Testfall je Kritikpunkt. Jeder Fall ist eine eigene kleine Seite (damit sich
// seitenweite Eingriffe wie lang oder Skip-Link nicht gegenseitig stören).
//
//   id        Kurzname
//   kritik    Bezug zum Review / zur Evaluation
//   erwartung Was ein korrektes Skript tun soll (Klartext, erscheint auch auf der Spielwiese)
//   html      Die Testseite
//   ai        true = mit KI-Zustimmung laufen (Mock-Antwort, kein echter API-Aufruf)
//   check     Läuft nach dem Skript im Browser; liefert { pass, detail }
//
// Hilfsfunktionen im Browser (von scripts/test-cases.mjs bereitgestellt):
//   __name(el)   zugänglicher Name nach axe
//   __ratio(el)  Kontrast Text/effektiver Hintergrund nach axe

const page = (body, { lang = 'en', title = 'Testfall', head = '' } = {}) =>
  `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><main id="inhalt"><h1>${title}</h1>${body}</main></body></html>`;

const GERMAN = 'Dies ist eine deutschsprachige Seite. Sie enthält genug Text, damit man die Sprache sicher erkennen kann. Wir verkaufen Bücher und Spiele für die ganze Familie, und die Lieferung ist in Österreich und Deutschland kostenlos. Bei Fragen ist unser Kundendienst von Montag bis Freitag für Sie da und hilft gerne weiter.';
const ENGLISH = 'This is an English page. It contains enough text so that the language can be detected reliably. We sell books and games for the whole family, and delivery is free in the United Kingdom and Ireland. If you have questions, our customer service is there for you from Monday to Friday and is happy to help.';

export const CASES = [
  // ─── K1 Kontrast ─────────────────────────────────────────────────────────────────────────
  {
    id: 'k1-dunkler-hintergrund', kritik: 'K1 Kontrast', titel: 'Graue Schrift auf fast schwarzem Grund',
    erwartung: 'Die Schrift wird heller (nicht schwarz) und erreicht mindestens 4,5:1.',
    html: page('<p id="t" style="color:#535557;background:#141618">Graue Schrift auf Schwarz (Ausgangskontrast 2,4:1)</p>'),
    check: () => { const r = __ratio(document.getElementById('t')); return { pass: r >= 4.5, detail: `Kontrast nachher ${r.toFixed(2)}:1` }; },
  },
  {
    id: 'k1-hintergrund-am-eltern', kritik: 'K1 Kontrast', titel: 'Hintergrund am Elternelement',
    erwartung: 'Der Hintergrund des Elternelements wird berücksichtigt; Kontrast danach mindestens 4,5:1. (v140 sieht hier keinen Hintergrund und tut nichts.)',
    html: page('<div style="background:#1b1f24;padding:8px"><span id="t" style="color:#5a6068">Grau auf dunklem Kasten</span></div>'),
    check: () => { const r = __ratio(document.getElementById('t')); return { pass: r >= 4.5, detail: `Kontrast nachher ${r.toFixed(2)}:1` }; },
  },
  {
    id: 'k1-heller-hintergrund', kritik: 'K1 Kontrast', titel: 'Hellgrau auf Weiß',
    erwartung: 'Die Schrift wird dunkler und erreicht mindestens 4,5:1.',
    html: page('<p id="t" style="color:#a0a0a0;background:#ffffff">Hellgrau auf Weiß</p>'),
    check: () => { const r = __ratio(document.getElementById('t')); return { pass: r >= 4.5, detail: `Kontrast nachher ${r.toFixed(2)}:1` }; },
  },
  {
    id: 'k1-marker-nur-bei-aenderung', kritik: 'K1 Kontrast (291 vs. 293)', titel: 'Schwarz auf Dunkelgrau',
    erwartung: 'Wird das Element als korrigiert markiert, muss der Kontrast danach auch stimmen. (v140 markiert es, ohne die Farbe zu ändern.)',
    html: page('<p id="t" style="color:#000000;background:#4d4d4d">Schwarz auf Dunkelgrau (2,5:1)</p>'),
    check: () => { const el = document.getElementById('t'); const r = __ratio(el); const m = el.hasAttribute('data-a11y-contrast');
      return { pass: !m || r >= 4.5, detail: `markiert: ${m}, Kontrast nachher ${r.toFixed(2)}:1` }; },
  },
  {
    id: 'k1-guter-kontrast-bleibt', kritik: 'K1 Kontrast', titel: 'Guter Kontrast bleibt unverändert',
    erwartung: 'Text, der AAA schon erfüllt, wird nicht angefasst.',
    html: page('<p id="t" style="color:#222222;background:#ffffff">Dunkelgrau auf Weiß</p>'),
    check: () => { const el = document.getElementById('t'); return { pass: !el.hasAttribute('data-a11y-contrast') && getComputedStyle(el).color === 'rgb(34, 34, 34)', detail: getComputedStyle(el).color }; },
  },

  // ─── K2 Diagnosetext in title ────────────────────────────────────────────────────────────
  {
    id: 'k2-kein-warntext-im-title', kritik: 'K2 title-Warntext', titel: 'Leere Überschrift, Überschriftensprung, Submit ohne value',
    erwartung: 'Befunde erscheinen im Panel, aber kein Element bekommt einen title mit Warntext (der würde vorgelesen).',
    html: page('<h3>Sprung von H1 auf H3</h3><h2></h2><form><input type="submit"></form>'),
    check: () => { const w = [...document.querySelectorAll('[title]')].filter((e) => !e.closest('#a11y-panel') && e.title.startsWith('⚠'));
      return { pass: w.length === 0, detail: w.length ? w.map((e) => `<${e.tagName.toLowerCase()} title="${e.title}">`).join(', ') : 'kein Warntext in title' }; },
  },
  {
    id: 'k2-submit-behaelt-namen', kritik: 'K2 title-Warntext', titel: 'Submit-Button behält seinen Standardnamen',
    erwartung: 'Der Name bleibt „Submit“ (Browser-Standard) und wird nicht zu „⚠ input[submit] without label“.',
    html: page('<form><input id="t" type="submit"></form>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: !n.startsWith('⚠'), detail: `Name: „${n}“` }; },
  },

  // ─── K3 Platzhalter-Namen ────────────────────────────────────────────────────────────────
  {
    id: 'k3-button-ohne-quelle', kritik: 'K3 Platzhalter', titel: 'Button ohne jede Beschriftung',
    erwartung: 'Kein erfundener Name wie „Button“; stattdessen Hinweis im Panel.',
    html: page('<button id="t" class="fancy"></button>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n !== 'Button', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k3-link-ohne-quelle', kritik: 'K3 Platzhalter', titel: 'Leerer Link',
    erwartung: 'Kein URL-Label (Screenreader lesen die URL ohnehin vor); Hinweis im Panel.',
    html: page('<a id="t" href="/angebote/sommer-2026"></a>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: !/^https?:/.test(n) && n !== 'Link', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k3-feld-nur-typ', kritik: 'K3 Platzhalter', titel: 'Telefonfeld ohne Label',
    erwartung: 'Kein Name aus dem Feldtyp („Tel“); Hinweis im Panel.',
    html: page('<form><input id="t" type="tel"></form>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n.toLowerCase() !== 'tel', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k3-select-typ', kritik: 'K3 Platzhalter', titel: 'Select ohne Label',
    erwartung: 'Kein Name „Select one“ (das ist der interne Typ).',
    html: page('<form><select id="t"><option>A</option></select></form>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n !== 'Select one', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k3-nachbartext', kritik: 'K3 Platzhalter', titel: 'Feld mit sichtbarem Text davor',
    erwartung: 'Der sichtbare Text „E-Mail-Adresse“ wird als Name übernommen.',
    html: page('<form><p>E-Mail-Adresse: <input id="t" type="email"></p></form>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n === 'E-Mail-Adresse', detail: `Name: „${n}“` }; },
  },

  // ─── K4 Vorhandene Namen überschreiben ───────────────────────────────────────────────────
  {
    id: 'k4-umschliessendes-label', kritik: 'K4 Überschreiben', titel: 'Label umschließt das Feld (AccessGuru #33)',
    erwartung: 'Name bleibt „Geburtsdatum“ (v140 macht daraus „Fname“).',
    html: page('<form><label>Geburtsdatum <input id="t" name="fname" type="text"></label></form>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n === 'Geburtsdatum', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k4-input-image-alt', kritik: 'K4 Überschreiben', titel: 'Bild-Button mit alt (AccessGuru #45)',
    erwartung: 'Name bleibt „Clear Form“ (v140 macht daraus „Image“).',
    html: page('<form><input id="t" type="image" alt="Clear Form" src="icon.svg"></form>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n === 'Clear Form', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k4-button-title', kritik: 'K4 Überschreiben', titel: 'Icon-Button mit title (AccessGuru #49)',
    erwartung: 'Name bleibt „Dokument hochladen“ (v140 macht daraus „Button“).',
    html: page('<button id="t" title="Dokument hochladen"><img src="icon.png" alt=""></button>'),
    check: () => { const n = __name(document.getElementById('t')); return { pass: n === 'Dokument hochladen', detail: `Name: „${n}“` }; },
  },
  {
    id: 'k4-label-for-sonderzeichen', kritik: 'K4/K8', titel: 'label[for] mit Leerzeichen in der ID',
    erwartung: 'Das Label wird erkannt, der Name bleibt „Größe“.',
    html: page('<form><label for="gr ö">Größe</label><input id="gr ö" name="size"></form>'),
    check: () => { const n = __name(document.getElementById('gr ö')); return { pass: n === 'Größe', detail: `Name: „${n}“` }; },
  },

  // ─── K5 <a> ohne href ──────────────────────────────────────────────────────────────────────
  {
    id: 'k5-anker-ohne-href', kritik: 'K5 aria-prohibited-attr', titel: 'Sprungmarke <a name> ohne href',
    erwartung: 'Kein aria-label (auf einem Element ohne Rolle verboten).',
    html: page('<a id="t" name="anker1"></a><p>Text</p>'),
    check: () => { const el = document.getElementById('t'); return { pass: !el.hasAttribute('aria-label'), detail: el.outerHTML }; },
  },

  // ─── K6 SVG verstecken ─────────────────────────────────────────────────────────────────────
  {
    id: 'k6-svg-mit-link', kritik: 'K6 SVG', titel: 'Link innerhalb einer SVG-Grafik (AccessGuru #24)',
    erwartung: 'Die SVG wird nicht mit aria-hidden versteckt, der Link „Los“ bleibt erreichbar.',
    html: page('<svg width="60" height="20"><a id="t" href="/start"><text x="0" y="15">Los</text></a></svg>'),
    check: () => { const a = document.getElementById('t'); const hidden = !!a.closest('[aria-hidden="true"]'); return { pass: !hidden && __name(a) === 'Los', detail: `versteckt: ${hidden}, Name: „${__name(a)}“` }; },
  },
  {
    id: 'k6-deko-svg', kritik: 'K6 SVG', titel: 'Rein dekorative SVG',
    erwartung: 'Eine SVG ohne Text/Titel/Link darf versteckt werden (aria-hidden).',
    html: page('<svg id="t" width="10" height="10"><path d="M0 0h10v10z"/></svg>'),
    check: () => { const s = document.getElementById('t'); return { pass: s.getAttribute('aria-hidden') === 'true', detail: s.outerHTML.slice(0, 80) }; },
  },

  // ─── K7 lang ───────────────────────────────────────────────────────────────────────────
  {
    id: 'k7-deutsche-seite', kritik: 'K7 lang', titel: 'Deutsche Seite ohne lang',
    erwartung: 'Nicht lang="en" setzen. Richtig ist lang="de" oder gar nichts.',
    html: page(`<p>${GERMAN}</p>`, { lang: null, title: 'Willkommen' }),
    check: () => { const l = document.documentElement.getAttribute('lang'); return { pass: l !== 'en', detail: `lang=${JSON.stringify(l)}` }; },
  },
  {
    id: 'k7-englische-seite', kritik: 'K7 lang', titel: 'Englische Seite ohne lang',
    erwartung: 'lang="en" wird gesetzt.',
    html: page(`<p>${ENGLISH}</p>`, { lang: null, title: 'Welcome' }),
    check: () => { const l = document.documentElement.getAttribute('lang'); return { pass: l === 'en', detail: `lang=${JSON.stringify(l)}` }; },
  },
  {
    id: 'k7-zu-wenig-text', kritik: 'K7 lang', titel: 'Seite mit sehr wenig Text',
    erwartung: 'Sprache nicht sicher erkennbar → nichts raten.',
    html: page('<p>Hallo</p>', { lang: null, title: 'Kurz' }),
    check: () => { const l = document.documentElement.getAttribute('lang'); return { pass: l === null, detail: `lang=${JSON.stringify(l)}` }; },
  },

  // ─── K8 Absturz ─────────────────────────────────────────────────────────────────────────
  {
    id: 'k8-id-mit-zeilenumbruch', kritik: 'K8 Absturz (glossier.com)', titel: 'Feld-ID endet auf Zeilenumbruch',
    erwartung: 'Kein Absturz; die übrigen Module laufen (hier: Kontrast wird korrigiert).',
    html: page('<form><input id="option1-Banana Pudding\n" name="flavor"></form><p id="t" style="color:#aaaaaa;background:#ffffff">Hellgrau</p>'),
    check: () => { const r = __ratio(document.getElementById('t')); return { pass: !window.__injectError && r >= 4.5, detail: window.__injectError ? `Absturz: ${window.__injectError}` : `kein Absturz, Kontrast ${r.toFixed(2)}:1` }; },
  },

  // ─── K9 KI ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'k9-keine-abfrage-ohne-zustimmung', kritik: 'K9 KI/Datenschutz', titel: 'Ohne Zustimmung keine Key-Abfrage und keine Übertragung',
    erwartung: 'Solange die KI nicht eingeschaltet ist: kein prompt()-Dialog, keine Anfrage an HuggingFace.',
    html: page('<img id="t" src="foto.png" width="300" height="200">'),
    check: () => { const L = window.__augLog; return { pass: L.prompts === 0 && L.gmXhr.length === 0, detail: `prompt(): ${L.prompts}, Anfragen: ${L.gmXhr.length}` }; },
  },
  {
    id: 'k9-dekoratives-bild-im-link', kritik: 'K9 KI', titel: 'Bild in einem Link mit Text',
    erwartung: 'Das Bild ist dekorativ und bekommt alt="" statt einer KI-Beschreibung.',
    ai: true,
    html: page('<a href="/produkt"><img id="t" src="foto.png" width="300" height="200"> Produktseite</a>'),
    check: () => { const i = document.getElementById('t'); return { pass: i.getAttribute('alt') === '', detail: `alt=${JSON.stringify(i.getAttribute('alt'))}, KI-Anfragen: ${window.__augLog.gmXhr.length}` }; },
  },
  {
    id: 'k9-prompt-sprache-kontext', kritik: 'K9 KI', titel: 'KI-Anfrage auf deutscher Seite',
    erwartung: 'Die Anfrage verlangt einen deutschen Alt-Text und enthält den Kontext (Bildunterschrift).',
    ai: true,
    html: page('<figure><img id="t" src="foto.png" width="300" height="200"><figcaption>Unser Team beim Sommerfest 2026</figcaption></figure>', { lang: 'de', title: 'Über uns' }),
    check: () => { const p = (window.__augLog.gmXhr[0] || {}).prompt || '';
      return { pass: /German/.test(p) && /Sommerfest/.test(p), detail: p ? `Prompt: ${p.slice(0, 160)}…` : 'keine KI-Anfrage' }; },
  },
  {
    id: 'k9-alt-wird-gesetzt', kritik: 'K9 KI', titel: 'Bild ohne alt wird beschrieben',
    erwartung: 'Mit Zustimmung bekommt ein Bild ohne alt eine Beschreibung (hier Mock-Antwort).',
    ai: true,
    html: page('<img id="t" src="foto.png" width="300" height="200">'),
    check: () => { const i = document.getElementById('t'); return { pass: !!i.getAttribute('alt'), detail: `alt=${JSON.stringify(i.getAttribute('alt'))}` }; },
  },

  // ─── K10 Panel ─────────────────────────────────────────────────────────────────────────
  {
    id: 'k10-panel-barrierefrei', kritik: 'K10 Panel', titel: 'Das AugmentAble-Panel selbst',
    erwartung: 'Das Panel verursacht keine axe-Verstöße (Kontrast AA/AAA, scrollbare Bereiche, Landmark).',
    html: page('<p>Seite mit Panel</p>'),
    axePanel: true,
    check: () => ({ pass: window.__panelViolations.length === 0, detail: window.__panelViolations.length ? window.__panelViolations.join(', ') : 'keine Verstöße' }),
  },
];
