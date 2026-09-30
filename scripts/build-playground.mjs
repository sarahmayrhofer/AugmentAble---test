// Baut die Spielwiese (docs/) aus tests/cases.mjs:
//   docs/index.html        Übersicht mit Installationslink und allen Testfällen
//   docs/cases/<id>.html   je Testfall eine eigene Seite
// Zum manuellen Testen mit Tampermonkey (über GitHub Pages oder lokal).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from '../tests/cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.GITHUB_REPOSITORY || 'sarahmayrhofer/AugmentAble---test';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
// Testbild: öffentliches PNG mit CORS-Freigabe (aus dem AccessGuru-Repo)
const FOTO = 'https://raw.githubusercontent.com/NadeenAhmad/AccessGuruLLM/bf45666aa281af7cca23aaabd9bfe3bd802b9036/data/accessguru_dataset/accessguru_semantic_violations_sampled_dataset_supp_material/50.png';

const docs = path.join(ROOT, 'docs');
mkdirSync(path.join(docs, 'cases'), { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

for (const c of CASES) {
  let html = c.html.replace(/src="(foto|icon)\.png"/g, `src="${FOTO}"`);
  // kleiner Zurück-Link am Ende (stört die Testfälle nicht)
  html = html.replace('</body>', '<p style="margin-top:3em;font:14px sans-serif"><a href="../index.html">← zurück zur Übersicht</a></p></body>');
  writeFileSync(path.join(docs, 'cases', c.id + '.html'), html);
}
writeFileSync(path.join(docs, 'cases', 'kitchen-sink.html'), readFileSync(path.join(ROOT, 'tests', 'fixtures', 'kitchen-sink.html'), 'utf8'));

const groups = {};
for (const c of CASES) (groups[c.kritik.split(' ')[0]] ||= []).push(c);
const index = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AugmentAble – Spielwiese</title>
<style>
  body{font:16px/1.55 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1.5rem;color:#1a1a1a;background:#fff}
  h1{font-size:1.7rem} h2{margin-top:2rem;border-bottom:2px solid #ddd;padding-bottom:.2rem}
  .box{background:#f3f0ff;border:1px solid #c4b5fd;border-radius:8px;padding:1rem;margin:1rem 0}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:.45rem;vertical-align:top;text-align:left}
  th{background:#f5f5f5} a{color:#4c1d95} code{background:#f1f1f1;padding:0 .25em;border-radius:3px}
</style></head>
<body>
<main>
<h1>AugmentAble – Spielwiese</h1>
<div class="box">
  <p><strong>So testen Sie von Hand:</strong></p>
  <ol>
    <li>Tampermonkey installieren, dann <strong>eine</strong> Skriptversion installieren (die andere deaktivieren):
      <ul>
        <li><a href="${RAW}/userscript/augmentable.user.js">v141 (korrigiert) installieren</a></li>
        <li><a href="${RAW}/userscript/original/augmentable-v140.user.js">v140 (Original) installieren</a></li>
      </ul></li>
    <li>Einen Testfall öffnen. Rechts unten erscheint das AugmentAble-Panel; „Outlines“ zeigt, was das Skript verändert hat.</li>
    <li>Mit Screenreader (NVDA, VoiceOver) oder in den DevTools unter <em>Accessibility</em> prüfen, ob die <em>Erwartung</em> erfüllt ist.</li>
    <li>KI-Fälle (K9): im Panel „KI-Bildbeschreibung“ einschalten, HuggingFace-Key eingeben.</li>
  </ol>
  <p>Automatisch geprüft werden dieselben Fälle mit <code>npm test</code> bzw. bei jedem Push (Actions → Evaluation → Summary).</p>
</div>
<p><a href="cases/kitchen-sink.html">Gesamtseite mit allen Problemen auf einmal</a></p>
${Object.entries(groups).map(([k, cs]) => `<h2>${esc(k)} – ${esc(cs[0].kritik.replace(/^\S+\s*/, ''))}</h2>
<table><thead><tr><th scope="col">Testfall</th><th scope="col">Erwartung</th></tr></thead><tbody>
${cs.map((c) => `<tr><td><a href="cases/${c.id}.html">${esc(c.titel)}</a>${c.ai ? ' <em>(KI)</em>' : ''}</td><td>${esc(c.erwartung)}</td></tr>`).join('\n')}
</tbody></table>`).join('\n')}
</main>
</body></html>
`;
writeFileSync(path.join(docs, 'index.html'), index);
console.log(`Spielwiese: docs/index.html + ${CASES.length + 1} Testseiten`);
