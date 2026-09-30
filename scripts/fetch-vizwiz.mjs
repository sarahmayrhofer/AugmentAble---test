// VizWiz-Captions (Gurari et al., ECCV 2020; CC BY 4.0) für die KI-Bewertung holen.
// Fotos, die blinde Menschen aufgenommen haben, mit je 5 menschlichen Beschreibungen.
//   Annotationen: annotations.zip (val.json)   Bilder: val.zip (Validierungssplit, 7.750 Bilder)
// Es wird eine feste Stichprobe (VIZWIZ_N, Standard 100, Seed 42) entpackt.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DATA } from '../harness/dataset.mjs';

const DIR = path.join(DATA, 'vizwiz');
const N = +(process.env.VIZWIZ_N || 100);
mkdirSync(DIR, { recursive: true });

const get = (url, dest) => {
  if (existsSync(dest) && statSync(dest).size > 1000) return;
  console.log('↓', url);
  execSync(`curl -fL --retry 3 -o "${dest}" "${url}"`, { stdio: 'inherit' });
};
get('https://vizwiz.cs.colorado.edu/VizWiz_final/caption/annotations.zip', path.join(DIR, 'annotations.zip'));
if (!existsSync(path.join(DIR, 'annotations', 'val.json'))) execSync(`unzip -q -o "${path.join(DIR, 'annotations.zip')}" -d "${DIR}"`);

const ann = JSON.parse(readFileSync(path.join(DIR, 'annotations', 'val.json'), 'utf8'));
const caps = new Map();
for (const a of ann.annotations) {
  if (a.is_rejected || a.is_precanned) continue; // "Quality issues are too severe…" u. ä. ausschließen
  (caps.get(a.image_id) || caps.set(a.image_id, []).get(a.image_id)).push(a.caption);
}
let pool = ann.images.filter((im) => (caps.get(im.id) || []).length >= 3);
// deterministische Stichprobe
let s = 42; const rnd = () => ((s = Math.imul(48271, s) % 2147483647) / 2147483647);
pool = pool.map((im) => [rnd(), im]).sort((a, b) => a[0] - b[0]).slice(0, N).map((x) => x[1]);
const sample = pool.map((im) => ({ file: im.file_name, id: im.id, text_detected: im.text_detected, captions: caps.get(im.id) }));

const imgDir = path.join(DIR, 'val');
const missing = sample.filter((x) => !existsSync(path.join(imgDir, x.file)));
if (missing.length) {
  get('https://vizwiz.cs.colorado.edu/VizWiz_final/images/val.zip', path.join(DIR, 'val.zip'));
  // nur die Stichprobe entpacken
  const list = path.join(DIR, 'sample-files.txt');
  writeFileSync(list, missing.map((x) => `val/${x.file}`).join('\n'));
  execSync(`unzip -q -o "${path.join(DIR, 'val.zip')}" $(cat "${list}") -d "${DIR}"`, { stdio: 'inherit', shell: '/bin/bash' });
}
writeFileSync(path.join(DIR, 'sample.json'), JSON.stringify(sample, null, 1));
console.log(`VizWiz-Stichprobe: ${sample.length} Bilder, ${sample.filter((x) => existsSync(path.join(imgDir, x.file))).length} vorhanden`);
