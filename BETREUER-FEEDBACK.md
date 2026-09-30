# Antwort auf das Feedback des Betreuers

Dieses Dokument geht die Kritikpunkte zur ersten Evaluation (`AugmentAble-Evaluation 1 3.pdf`) einzeln durch. Zu jedem Punkt steht, was sich geändert hat und wo der Beleg liegt. Alle Zahlen erzeugt die Testumgebung in diesem Repo selbst und schreibt sie für **v140 (Original, Stand der ersten Evaluation)** und **v141 (korrigiert)** nebeneinander in den Report.

- Reproduzieren: **Actions → Evaluation → Run workflow** (Option `script: both`, für die KI zusätzlich `ai: true`)
- Ergebnis: Summary des Laufs, dort `COMPARE.md` und je Version `REPORT.md`
- Testfälle je Kritikpunkt: `npm test` bzw. bei jedem Push (`results/tests.md`)

---

## 1. „Warum wird die KI nicht überprüft? Ist nicht das, was uns eigentlich interessiert?“

**Zutreffend.** In der ersten Evaluation lief das Skript ohne API-Key. Damit war der eigentliche Beitrag, die KI-Bildbeschreibung, abgeschaltet, und gemessen wurden nur die regelbasierten Teile. Das sieht man an `image-alt`: 1571 → 1571.

**Jetzt wird die KI auf vier Ebenen geprüft.** Alle Aufrufe gehen echt an HuggingFace, über den unveränderten Skriptpfad (Canvas → `GM_xmlhttpRequest`). Die Harness bildet nur Tampermonkey nach und protokolliert je Anfrage Modell, Status, Latenz und Prompt.

| Ebene | Frage | Wo |
| --- | --- | --- |
| Erreichbarkeit | Antworten die drei Modelle der Fallback-Kette überhaupt? | Workflow **KI-Check**, `results/<v>/ai-check.md` |
| Qualität gegen Expert:innen | Wie nah sind die KI-Alt-Texte an den drei Entwickler-Korrekturen der AccessGuru-Bildfälle? (SBERT wie im AccessGuru-Paper) | Report §5 |
| Qualität gegen Menschen (größer) | Stichprobe aus VizWiz-Captions (Fotos blinder Menschen, je 5 menschliche Beschreibungen), mit **Obergrenze Mensch ↔ Mensch** als Maßstab | Report §5, `vizwiz_summary.json` |
| Typische Fehler | Sprache (deutsche Seite → deutscher Alt-Text?), Stabilität (zwei Läufe), Länge, „Image of …“, dekorative Bilder, Datenabfluss an Dritte | Report §5, Testfälle K9 |
| Menschliches Urteil | Blindes Bewertungsblatt: KI-Text und menschlicher Text als A/B mit verdeckter Herkunft, bewertet nach Korrektheit, Relevanz, Länge und Erfindungen | `rating_sheet.csv` + `rating_key.csv` |

Allein durch die Harness gefundene Schwächen des KI-Pfads in v140:
- Der Prompt ist fest auf Englisch. Auf einer deutschen Seite entstehen daher englische Alt-Texte, also eine neue *lang-mismatch*-Violation.
- Das Skript schickt nur das Bild, ohne Kontext. Derselbe Alt-Text erscheint deshalb unabhängig vom Zweck des Bildes.
- Bei CDN-Bildern ohne CORS-Freigabe scheitert `canvas.toDataURL`, das Bild wird gar nicht beschrieben.
- Auch dekorative Bilder in Links mit Text werden an die KI geschickt.
- Ohne Key fragt das Skript auf **jeder** Seite per `prompt()` nach dem Key. Mit Key gehen Bilder ohne gesonderte Zustimmung an Dritte.

v141 behebt diese Punkte (Testfälle K9).

## 2. „175 + 91 + 25 = 291, im Text steht 293“

**Aufgelöst.** Es sind 2 Fälle mit bereits schwarzem Text (`#000` auf `#4d4d4d`, thehindu.com, einmal als `color-contrast`, einmal als `-enhanced`). `fixContrast()` kann nur abdunkeln. Das Skript setzt deshalb den Marker `data-a11y-contrast`, ändert die Farbe aber nicht. Daraus ergibt sich: markiert 293, geändert 291.

- Die Ergebnistabelle hat jetzt die eigene Zeile **„markiert, Farbe unverändert“**.
- Jede Tabelle wird automatisch gegen N geprüft. Geht eine Summe nicht auf, schlägt der Lauf fehl.
- Ebenfalls geklärt: „553 eindeutige Fälle“ zählt *(Regel, fg, bg, Größe, Schnitt)*. Dieselbe Farbkombination kommt deshalb doppelt vor, woher die scheinbaren Duplikate in der Liste stammen. Von den 27 auf Schwarz gesetzten Farben sind 23 verschlechtert und 4 verbessert, reichen aber nicht.
- Die Regressionen sind in v141 behoben. Das Skript berechnet den Hintergrund über die Elternkette und hellt auf dunklem Grund auf. Ergebnis: 0 verschlechtert, alle 293 Fälle unter AA behoben, und zwar auch in Variante B, in der v140 nichts erkennt. Testfälle K1.

## 3. „AccessGuru faktisch nur als Seitenkorpus …“

**Zutreffend. AccessGuru wird jetzt als Benchmark verwendet.**

- **Korpus erklärt** (Report §1): 3.524 annotierte Violations → 588 URLs → 468 Hosts → 602 HTML-Dateien → lokal vorhanden → ausgewertet → Abstürze. Die „448 Websites“ aus dem Paper lassen sich aus den veröffentlichten Daten nicht reproduzieren: Das README des Datensatzes nennt 588 URLs, die Daten enthalten 468 Hosts. Die Einheit der Seiten-Evaluation ist die HTML-Datei.
- **Recall gegen annotierte Violations** (Report §3): Jede Syntax- und Layout-Annotation wird über ihr axe-Snippet dem Element zugeordnet und nach dem Skript erneut geprüft. Ausgewiesen werden behoben, *inhaltlich* behoben, teilweise, nicht behoben und nicht zuordenbar. Die letzte Gruppe steht getrennt, weil die Annotationen mit axe 4.4 entstanden sind.
- **Semantische Kategorie** (Report §4): 55 semantische Fälle mit je 3 Entwickler-Korrekturen. Gemessen wird, ob das Skript den relevanten Wert *näher an die Expertenkorrektur* bringt (SBERT bzw. Jaccard wie im Paper). Ergebnis v140 (lokaler Lauf, Token-F1; in GitHub mit SBERT): 8 Fälle verändert, 2 näher an der Korrektur, **5 weiter weg**. Beispiele für „weiter weg“: Aus dem Label „Date“ wird „Fname“, aus „Clear Form“ wird „Image“, und ein Link „Go“ verliert seinen Namen, weil seine SVG versteckt wird. v141 verändert keinen der 55 Fälle mehr. Es richtet damit keinen Schaden an, verliert aber auch die 2 zufälligen Treffer. Semantische Fehlbeschriftungen *korrigiert* keine der beiden Versionen, das bleibt eine Aufgabe für die KI.
- **Präzision** (Report §6.1): Jedes gesetzte Label wird nach Quelle eingeordnet (*belegt*, *ungeprüft* oder *Schein*). Daraus entstehen eine Unter- und eine Obergrenze. `manual_review_sample.csv` enthält 300 Labels für die echte Präzision per Handbewertung. Eine automatische Präzision gegen AccessGuru ist nicht möglich, weil die Annotation nicht vollständig ist: Ein Eingriff an einem nicht annotierten Element ist nicht automatisch falsch.
- Die Label-Qualität steht jetzt ausdrücklich in der **semantischen** Kategorie der Taxonomie. Ein aria-label „Button“ ist im AccessGuru-Sinn eine neue *button-label-mismatch*-Violation, `lang="en"` auf einer deutschen Seite eine neue *lang-mismatch*-Violation.

## 4. „title mit Warntext ist keine Nebenwirkung, sondern ein direkter Schaden“

**Zutreffend.** `checkHeadings()` und `checkLabels()` schreiben Diagnosetext in `title`. Das ist für alle als Tooltip sichtbar und wird von Screenreadern als Name oder Beschreibung vorgelesen. Bei einem `input[type=submit]` ersetzt „⚠ input[submit] without label“ sogar den korrekten Standardnamen „Submit“.

- **Gemessen** (Report §6.3): wie oft Warntext gesetzt wird und wie oft er zum *zugänglichen Namen* wird.
- **Herausgerechnet** (Report §2): Das *bereinigte Delta* zählt Knoten, deren „Reparatur“ nur aus Warntext, Platzhalter, URL, Feldtyp oder falschem `lang` besteht, nicht als behoben. Die −9,8 % der ersten Evaluation schrumpfen dadurch deutlich.
- **Vorhandene Namen überschrieben** (Report §6.2): Elemente, die vorher schon einen korrekten Namen hatten und danach einen anderen oder keinen.
- **Behoben in v141**: Befunde stehen nur noch im Panel und in `data-*`-Attributen (Testfälle K2).

---

## Weitere Befunde aus der neuen Testumgebung (über das Feedback hinaus)

| # | Befund in v140 | Fix in v141 | Testfall |
| --- | --- | --- | --- |
| K3 | Platzhalter-Namen „Button“, „Link“, „Field“, Feldtyp („Tel“, „Select one“), URL | Namen nur aus inhaltlichen Quellen, sonst Hinweis im Panel | K3 |
| K4 | Vorhandene Namen werden überschrieben (umschließendes `<label>`, `alt` bei `input[type=image]`, `title` am Button) | Namensprüfung über `el.labels`, `aria-labelledby`, `title`, `alt` | K4 |
| K5 | `aria-label` auf `<a>` ohne `href` (→ `aria-prohibited-attr`, +208 Knoten) | Anker ohne `href` werden übersprungen | K5 |
| K6 | SVG mit Link wird mit `aria-hidden` versteckt, der Link ist für Screenreader weg | Nur rein grafische SVGs werden versteckt | K6 |
| K7 | `lang="en"` wird ungeprüft gesetzt | Sprache erkennen (Meta-Angaben, Stoppwörter), sonst nichts setzen | K7 |
| K8 | Eine `id` mit Zeilenumbruch bringt die gesamte IIFE zum Absturz (glossier.com) | `el.labels` statt `querySelector`, jedes Modul isoliert | K8 |
| K10 | Das Panel selbst verursacht Kontrast- und Scroll-Verstöße | AAA-Farben, Landmark, fokussierbare Bereiche | K10 |

## Grenzen, die offen bleiben

- **AAA-Kontrast:** v141 zielt auf AA (4,5:1 bzw. 3:1). Fälle, die AA erfüllen und AAA nicht, fasst es bewusst nicht an. Das ist eine Designentscheidung.
- **Nicht beschreibende Alt-Texte** (z. B. „ERCIM logo“ am W3C-Logo) erkennt das Skript nicht, weil es vorhandene Alt-Texte nicht von der KI prüfen lässt.
- **Automatische Ähnlichkeitsmetriken** sagen wenig darüber, ob ein Alt-Text Screenreader-Nutzer:innen hilft. Deshalb gibt es das Bewertungsblatt, idealerweise ausgefüllt von zwei Personen, mit Cohens κ.
