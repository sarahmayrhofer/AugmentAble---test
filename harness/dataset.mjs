// Laden der AccessGuru-Daten (CSV aus dem offiziellen Repo, Seiten aus DaRUS bzw. Live-Snapshot).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './core.mjs';

export const DATA = path.join(ROOT, 'data');
export const AG = path.join(DATA, 'accessguru');          // Klon von NadeenAhmad/AccessGuruLLM (gepinnt)
export const PAGES = path.join(DATA, 'pages');            // <html_file_name> je Seite

// Minimaler RFC-4180-CSV-Parser (Felder mit Zeilenumbrüchen und "" -Escapes)
export function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') {}
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export function loadViolations() {
  const f = path.join(AG, 'data', 'accessguru_dataset', 'Original_full_data_new.csv');
  if (!existsSync(f)) throw new Error(`${f} fehlt – zuerst "npm run fetch" ausführen`);
  return parseCsv(readFileSync(f, 'utf8'));
}

export function loadSemanticSample() {
  const base = path.join(AG, 'data', 'accessguru_dataset');
  const items = parseCsv(readFileSync(path.join(base, 'accessguru_sampled_semantic_violations.csv'), 'utf8'));
  const devs = [1, 2, 3].map((k) => parseCsv(readFileSync(path.join(AG, 'human_developer_correction_study', `humanCorrection_developer${k}.csv`), 'utf8')));
  return items.map((it) => {
    const no = +it['#'];
    return {
      no,
      type: it['Violation Type'],
      url: it.webURL,
      impact: it.Impact,
      html: it['Affected HTML'],
      human: devs.map((d) => {
        const r = d.find((x) => +(x.QuestionNumber ?? x['Questionaire number']) === no);
        return r ? cleanComments(r.HumanAnswer ?? r.Fix) || null : null;
      }),
      image: path.join(base, 'accessguru_semantic_violations_sampled_dataset_supp_material', `${no}.png`),
    };
  });
}

// In den Entwickler-Korrekturen steht der Marker als `<!-- … --">`. Das ist kein gültiges
// Kommentarende – ein Browser verschluckt alles danach bis zum nächsten `-->`, die Korrektur
// wäre unsichtbar. Wir reparieren nur dieses Kommentarende (im Report ausgewiesen).
export function cleanComments(html) {
  return html && html.replace(/--"\s*>/g, '-->');
}

// Python-Literal (supplementary_information) → JS-Objekt
export function parsePyDict(s) {
  if (!s || s[0] !== '{') return null;
  try {
    return JSON.parse(s.replace(/'/g, '"').replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false'));
  } catch { return null; }
}

/** Verfügbare Seiten-HTML-Dateien (Name → Pfad) */
export function localPages() {
  if (!existsSync(PAGES)) return new Map();
  return new Map(readdirSync(PAGES).filter((f) => /\.html?$/.test(f)).map((f) => [f, path.join(PAGES, f)]));
}

/** axe-Knoten-Snippets einer Annotation trennen ("<a ...>, <a ...>") */
export function splitAffected(s) {
  if (!s) return [];
  return s.split(/,\s(?=<)/).map((x) => x.trim()).filter(Boolean);
}

export const norm = (h) => (h || '').replace(/\s+/g, ' ').replace(/\s*\/?>$/, '>').trim();
