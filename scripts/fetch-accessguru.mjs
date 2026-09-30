// Holt den AccessGuru-Datensatz:
//  1. Annotationen + Expertenkorrekturen aus github.com/NadeenAhmad/AccessGuruLLM (gepinnter Commit)
//  2. Die gespeicherten HTML-Seiten aus DaRUS (doi:10.18419/DARUS-5177) über die Dataverse-API
//
// Aufruf: npm run fetch            (beides)
//         SKIP_DARUS=1 npm run fetch (nur GitHub-Teil, reicht für Kontrast + Semantik)
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { DATA, AG, PAGES, loadViolations } from '../harness/dataset.mjs';

const AG_REPO = 'https://github.com/NadeenAhmad/AccessGuruLLM.git';
const AG_COMMIT = 'bf45666aa281af7cca23aaabd9bfe3bd802b9036';
const DOI = 'doi:10.18419/DARUS-5177';
const DARUS = 'https://darus.uni-stuttgart.de';

mkdirSync(DATA, { recursive: true });

// ─── 1. GitHub ─────────────────────────────────────────────────────────────
if (!existsSync(path.join(AG, '.git'))) {
  console.log('Klone AccessGuruLLM …');
  execSync(`git clone --filter=blob:none ${AG_REPO} "${AG}"`, { stdio: 'inherit' });
}
execSync(`git -C "${AG}" checkout -q ${AG_COMMIT}`, { stdio: 'inherit' });
console.log('AccessGuruLLM @', AG_COMMIT);

// ─── 2. DaRUS ─────────────────────────────────────────────────────────────
const manifest = { doi: DOI, files: [], error: null };
if (!process.env.SKIP_DARUS) {
  try {
    const r = await fetch(`${DARUS}/api/datasets/:persistentId/?persistentId=${DOI}`);
    if (!r.ok) throw new Error(`Dataverse-API ${r.status}`);
    const ds = (await r.json()).data.latestVersion;
    manifest.version = `${ds.versionNumber}.${ds.versionMinorNumber}`;
    const dir = path.join(DATA, 'darus');
    mkdirSync(dir, { recursive: true });
    for (const f of ds.files) {
      const df = f.dataFile;
      const rel = path.join(f.directoryLabel || '', df.filename);
      manifest.files.push({ id: df.id, name: rel, size: df.filesize, md5: df.md5 || df.checksum?.value });
      const dest = path.join(dir, rel);
      if (existsSync(dest) && statSync(dest).size > 0) continue;
      mkdirSync(path.dirname(dest), { recursive: true });
      // format=original: tabellarische Dateien nicht als .tab, sondern im Originalformat
      const u = `${DARUS}/api/access/datafile/${df.id}${df.originalFileFormat ? '?format=original' : ''}`;
      console.log('↓', rel, (df.filesize / 1e6).toFixed(1), 'MB');
      const res = await fetch(u);
      if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    }
    // Archive entpacken
    for (const f of walk(dir)) {
      if (/\.zip$/i.test(f) && !existsSync(f + '.extracted')) {
        console.log('entpacke', path.basename(f));
        execSync(`unzip -q -o "${f}" -d "${f.replace(/\.zip$/i, '')}"`);
        writeFileSync(f + '.extracted', '');
      }
      if (/\.(tar\.gz|tgz)$/i.test(f) && !existsSync(f + '.extracted')) {
        const d = f.replace(/\.(tar\.gz|tgz)$/i, ''); mkdirSync(d, { recursive: true });
        execSync(`tar -xzf "${f}" -C "${d}"`); writeFileSync(f + '.extracted', '');
      }
    }
    // Seiten nach html_file_name einsortieren
    const wanted = new Set(loadViolations().map((v) => v.html_file_name));
    mkdirSync(PAGES, { recursive: true });
    let found = 0;
    for (const f of walk(dir)) {
      const b = path.basename(f);
      if (wanted.has(b)) { copyFileSync(f, path.join(PAGES, b)); found++; }
    }
    manifest.pagesMatched = found;
    manifest.pagesWanted = wanted.size;
    console.log(`Seiten zugeordnet: ${found} von ${wanted.size} im CSV referenzierten HTML-Dateien`);
    if (!found) console.log('⚠ Keine Seiten gefunden. Dateiliste steht in data/darus-manifest.json – ggf. Zuordnung in diesem Skript anpassen, oder "npm run fetch:live" für einen Live-Snapshot.');
  } catch (e) {
    manifest.error = String(e);
    console.error('⚠ DaRUS nicht erreichbar/auswertbar:', e.message);
    console.error('  Kontrast- und Semantik-Evaluation laufen trotzdem. Für die Seiten-Evaluation: "npm run fetch:live".');
  }
}
writeFileSync(path.join(DATA, 'darus-manifest.json'), JSON.stringify(manifest, null, 1));

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}
