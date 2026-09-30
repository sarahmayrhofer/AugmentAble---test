# AugmentAble – Testumgebung

Eine Testumgebung für das Userscript **AugmentAble**. Sie prüft das Skript gegen den AccessGuru-Benchmark ([doi:10.18419/DARUS-5177](https://doi.org/10.18419/DARUS-5177), CC BY 4.0; Code und Expertenkorrekturen: [NadeenAhmad/AccessGuruLLM](https://github.com/NadeenAhmad/AccessGuruLLM)) und testet die KI-Bildbeschreibung mit echten HuggingFace-Aufrufen. Alles lässt sich jederzeit reproduzieren.

**Antwort auf das Feedback des Betreuers:** [`BETREUER-FEEDBACK.md`](BETREUER-FEEDBACK.md)

> ### Einmalige Einrichtung: Workflows anlegen
> GitHub erlaubt Claude nicht, Dateien unter `.github/workflows/` anzulegen. Das geht einmalig von Hand (je etwa 1 Minute):
> 1. Im Ordner [`setup/workflows/`](setup/workflows) eine Datei öffnen, zum Beispiel `ki-check.yml`, dann **Raw** klicken, alles markieren und kopieren.
> 2. Im Repo **Add file → Create new file**. Als Namen `.github/workflows/ki-check.yml` eintippen (die Schrägstriche legen die Ordner an), den Inhalt einfügen und **Commit changes** klicken.
> 3. Dasselbe für `evaluation.yml` und optional `pages.yml` (Spielwiese) wiederholen.
>
> Danach erscheinen unter **Actions** die Workflows *KI-Check*, *Evaluation* und *Spielwiese*.

| Datei | Version |
| --- | --- |
| [`userscript/augmentable.user.js`](userscript/augmentable.user.js) | **v141** – korrigiert (siehe Änderungsliste im Dateikopf) |
| [`userscript/original/augmentable-v140.user.js`](userscript/original/augmentable-v140.user.js) | **v140** – Stand der ersten Evaluation (Code unverändert; Zeilenenden normalisiert) |

---

## Vier Arten zu testen

### 1. Testfälle je Kritikpunkt (automatisch, etwa 1 Minute)
28 kleine Testseiten, je eine pro Problem, zum Beispiel „Label umschließt Feld“, „Link in SVG“ oder „deutsche Seite ohne lang“. Beide Versionen laufen dagegen.
- **Bei jedem Push** automatisch: *Actions → Evaluation → letzter Lauf → Summary*
- Lokal: `npm test` (nur ein Kritikpunkt: `CASE=k4 npm test`)
- Eigene Fälle ergänzen: in [`tests/cases.mjs`](tests/cases.mjs) einen Eintrag mit `html` und `check` anlegen

### 2. KI-Check (echte HuggingFace-Aufrufe, etwa 2 Minuten)
*Actions → **KI-Check** → Run workflow.* Jedes Modell der Fallback-Kette beschreibt drei Testbilder über den echten Skriptpfad. Das Ergebnis zeigt pro Modell, ob es antwortet, den HTTP-Status, die Antwortzeit und die erzeugten Alt-Texte.
Voraussetzung ist das Secret `HF_API_KEY` (*Settings → Secrets and variables → Actions*).

### 3. Volle Evaluation (20–120 Minuten)
*Actions → **Evaluation** → Run workflow*:

| Option | Bedeutung |
| --- | --- |
| `script` | `both` = v140 und v141 nebeneinander (Standard) |
| `ai` | KI mit echten Aufrufen: AccessGuru-Bildfälle, VizWiz-Stichprobe, Sprache, Stabilität, Bewertungsblatt |
| `vizwiz_n` | Größe der VizWiz-Stichprobe (Standard 100) |
| `network` | `offline` = nur gespeichertes HTML (reproduzierbar). `live` = CSS und Bilder werden nachgeladen. Nur so sieht die KI auf echten Seiten Bilder. |
| `pages_source` | `darus` = gespeicherte Seiten des Datensatzes. `live` = alle URLs heute neu abrufen. |
| `limit` | z. B. `20` für einen Probelauf |

Ergebnis: In der Summary stehen `COMPARE.md` (v140 ↔ v141) und je Version ein `REPORT.md`. Unter *Artifacts* liegen alle Rohdaten, CSVs und Bewertungsblätter.

### 4. Spielwiese (von Hand, im Browser mit Tampermonkey)
Eine Übersichtsseite listet alle Testfälle mit ihrer Erwartung, jeder Fall hat eine eigene Seite.
- **Online:** einmalig *Settings → Pages → Build and deployment → Source: „GitHub Actions“* einstellen, dann *Actions → Spielwiese → Run workflow*. Danach unter `https://sarahmayrhofer.github.io/AugmentAble---test/` erreichbar. Bei Änderungen an den Testfällen wird die Seite automatisch neu gebaut.
- **Lokal:** `npm run playground` erzeugt `docs/`. Tampermonkey braucht dann „Zugriff auf Datei-URLs“ in den Erweiterungseinstellungen.
- Auf der Übersichtsseite gibt es Installationslinks für v141 und v140 (immer nur eine Version aktiv lassen).
- Prüfen im Browser über *DevTools → Elements → Accessibility* oder mit einem Screenreader (NVDA, VoiceOver).

---

## Lokal (VS Code)

```bash
git clone https://github.com/sarahmayrhofer/AugmentAble---test.git
cd AugmentAble---test
npm ci && npx playwright install chromium
SKIP_DARUS=1 npm run fetch          # AccessGuru-Annotationen (für Tests, Kontrast, Semantik)
npm test                            # Testfälle v140 ↔ v141
SCRIPT=original npm run all         # Evaluation v140 → results/original/REPORT.md
SCRIPT=fixed npm run all            # Evaluation v141 → results/fixed/REPORT.md
npm run compare                     # results/COMPARE.md
HF_API_KEY=hf_… npm run ai-check    # KI-Check lokal
```
Für die Ähnlichkeitsmetrik wie im Paper: `pip install sentence-transformers`. Ohne das Paket wird Token-F1 verwendet, und der Report weist das aus.

## Was gemessen wird

| Bereich | Messung | Report |
| --- | --- | --- |
| Korpus | CSV-Zeilen → URLs → Hosts → Seiten → ausgewertet | §1 |
| axe | Knoten vorher/nachher je Regel, **bereinigtes Delta** (Schein-Reparaturen herausgerechnet) | §2 |
| Recall | gegen die annotierten AccessGuru-Violations, gesamt und „streng“ (nur inhaltlich belegte Namen) | §3 |
| Semantik | 55 Fälle gegen je 3 Expertenkorrekturen (SBERT/Jaccard) | §4 |
| KI | Erreichbarkeit, Qualität (AccessGuru, VizWiz mit Obergrenze Mensch ↔ Mensch), Sprache, Stabilität, Datenabfluss, Bewertungsblatt | §5 |
| Schäden | Herkunft jedes Labels (Präzision), überschriebene Namen, Warntext in `title`, falsches `lang`, versteckte SVG-Links | §6 |
| Regressionen | neue Verstöße nach Verursacher | §7 |
| Panel | Verstöße des AugmentAble-Panels selbst | §8 |
| Kontrast | 553 Fälle, Hintergrund am Element (A) bzw. am Elternelement (B), Summenprüfung | §10 |

**Harness-Grundsätze:**
- Das Skript läuft unverändert. Die Harness bildet nur Tampermonkey nach (`GM_*`).
- Im KI-Modus wird das 6-s-Intervall verkürzt. Beim KI-Check wird zusätzlich die Reihenfolge der Modelle getauscht, damit jedes Modell einzeln geprüft wird. Beides steht im Report.
- Der KI-Key bleibt im Node-Prozess, die getestete Seite bekommt ihn nie zu sehen. KI-Antworten werden gecacht, damit Läufe reproduzierbar bleiben.
- Gepinnt sind axe-core 4.10.3, Playwright 1.56.1 und AccessGuruLLM @ `bf45666`.

## Aufbau

```
userscript/                     v141 (korrigiert), original/ v140
harness/core.mjs                Browser, Tampermonkey-Shim, KI-Proxy + Cache, axe
harness/dataset.mjs             AccessGuru laden (CSV, Expertenkorrekturen)
tests/cases.mjs                 Testfälle je Kritikpunkt
tests/fixtures/                 Testseiten für den Smoke-Test
tests/expected.json             Referenzwerte je Version (Smoke-Test)
scripts/test-cases.mjs          npm test
scripts/ai-check.mjs            KI-Check
scripts/eval-*.mjs              Kontrast, Semantik, Seiten, VizWiz
scripts/*similarity.py          SBERT/Jaccard, VizWiz-Auswertung + Bewertungsblatt
scripts/report.mjs, compare.mjs Report je Version, Vergleich
scripts/build-playground.mjs    Spielwiese (→ GitHub Pages)
setup/workflows/                Vorlagen für .github/workflows/ (siehe Einrichtung oben)
```

## Offener Punkt

Das Format der Seiten-Dateien in DaRUS ist noch nicht geprüft. `npm run fetch` lädt alle Dateien über die Dataverse-API und ordnet sie über `html_file_name` zu, das Ergebnis steht in `data/darus-manifest.json`. Ergibt die Zuordnung 0 Seiten, `pages_source: live` verwenden oder die Zuordnung im Skript anpassen.
