// Fallback, falls die HTML-Seiten nicht aus DaRUS kommen: jede URL aus dem
// AccessGuru-CSV live laden und das gerenderte DOM speichern.
// ACHTUNG: nicht reproduzierbar – Seiten ändern sich. Der Snapshot-Zeitpunkt
// wird in data/pages/_snapshot.json festgehalten und im Report ausgewiesen.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadViolations, PAGES } from '../harness/dataset.mjs';
import { pool } from '../harness/core.mjs';

mkdirSync(PAGES, { recursive: true });
const byFile = new Map();
for (const v of loadViolations()) if (!byFile.has(v.html_file_name)) byFile.set(v.html_file_name, v.web_URL);
let todo = [...byFile.entries()];
if (process.env.LIMIT) todo = todo.slice(0, +process.env.LIMIT);

const browser = await chromium.launch();
const log = [];
await pool(todo, 6, async ([file, url]) => {
  const dest = path.join(PAGES, file);
  if (existsSync(dest)) { log.push({ file, url, status: 'exists' }); return; }
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1500);
    writeFileSync(dest, await page.content());
    log.push({ file, url, status: 'ok' });
    console.log('✓', url);
  } catch (e) {
    log.push({ file, url, status: 'error', error: String(e.message).split('\n')[0] });
    console.log('✗', url, String(e.message).split('\n')[0]);
  } finally { await ctx.close(); }
});
await browser.close();
writeFileSync(path.join(PAGES, '_snapshot.json'), JSON.stringify({ source: 'live', created: new Date().toISOString(), log }, null, 1));
console.log(`gespeichert: ${log.filter((l) => l.status !== 'error').length} / ${todo.length}`);
