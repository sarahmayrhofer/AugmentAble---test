"""VizWiz: KI-Alt-Texte gegen 5 menschliche Beschreibungen.

- sim_mean / sim_max : SBERT-Kosinus KI ↔ jede menschliche Beschreibung (Mittel / bester Treffer)
- human_ceiling      : dieselbe Metrik Mensch ↔ die übrigen Menschen (leave-one-out) als Obergrenze
- stability          : SBERT KI-Lauf 1 ↔ KI-Lauf 2 (ohne Cache)
- Sprache            : Anteil deutscher Alt-Texte auf deutschen Seiten
Außerdem ein blindes Bewertungsblatt (rating_sheet.csv + rating_key.csv) für die menschliche Bewertung.
"""
import csv, json, os, random, re, statistics, sys
from pathlib import Path

RES = Path(__file__).resolve().parent.parent / "results" / os.environ.get("SCRIPT", "fixed")
data = json.loads((RES / "vizwiz.json").read_text())

try:
    from sentence_transformers import SentenceTransformer, util
    _m = SentenceTransformer("all-MiniLM-L6-v2")
    METRIC = "sbert-all-MiniLM-L6-v2-cosine"
    _c = {}
    def sim(a, b):
        for s in (a, b):
            if s not in _c:
                _c[s] = _m.encode(s, convert_to_tensor=True)
        return float(util.cos_sim(_c[a], _c[b])[0][0])
except Exception as e:  # noqa
    print("⚠ sentence-transformers fehlt – Fallback Token-F1:", e, file=sys.stderr)
    METRIC = "token-f1 (fallback)"
    def sim(a, b):
        ta, tb = re.findall(r"\w+", a.lower()), re.findall(r"\w+", b.lower())
        common = sum(min(ta.count(t), tb.count(t)) for t in set(ta))
        if not common:
            return 0.0
        p, r = common / len(ta), common / len(tb)
        return 2 * p * r / (p + r)

rows = []
for it in data["items"]:
    caps = it["captions"]
    alt = (it.get("en") or {}).get("alt")
    row = {"file": it["file"], "alt": alt, "model": (it.get("en") or {}).get("model"), "captions": caps}
    if alt:
        s = [sim(alt, c) for c in caps]
        row["sim_mean"], row["sim_max"] = statistics.mean(s), max(s)
    # menschliche Obergrenze: jede Beschreibung gegen die übrigen
    hs = [statistics.mean(sim(c, o) for j, o in enumerate(caps) if j != i) for i, c in enumerate(caps)]
    row["human_ceiling"] = statistics.mean(hs)
    rep = (it.get("repeat") or {}).get("alt")
    if alt and rep:
        row["stability"] = sim(alt, rep)
    if it.get("de"):
        row["de_alt"], row["de_lang"] = it["de"].get("alt"), it["de"].get("lang")
    row["len"] = len(alt) if alt else None
    rows.append(row)

ok = [r for r in rows if r.get("alt")]
de = [r for r in rows if "de_lang" in r]
def m(k, rs):
    v = [r[k] for r in rs if r.get(k) is not None]
    return round(statistics.mean(v), 3) if v else None

summary = {
    "metric": METRIC, "n": len(rows), "beschrieben": len(ok),
    "sim_mean": m("sim_mean", ok), "sim_max": m("sim_max", ok), "human_ceiling": m("human_ceiling", rows),
    "stability": m("stability", ok), "n_stability": len([r for r in ok if "stability" in r]),
    "de_n": len(de), "de_deutsch": sum(1 for r in de if r["de_lang"] == "deu"),
    "de_englisch": sum(1 for r in de if r["de_lang"] == "eng"),
    "laenge_median": statistics.median([r["len"] for r in ok]) if ok else None,
    "ueber_125_zeichen": sum(1 for r in ok if r["len"] > 125),
    "beginnt_mit_image_of": sum(1 for r in ok if re.match(r"^(an? )?(image|picture|photo) of", r["alt"], re.I)),
    "modelle": {k: sum(1 for r in ok if r["model"] == k) for k in {r["model"] for r in ok}},
}
(RES / "vizwiz_summary.json").write_text(json.dumps({"summary": summary, "items": rows}, indent=1, ensure_ascii=False))

# Blindes Bewertungsblatt: je Bild KI-Text und eine zufällige menschliche Beschreibung, Reihenfolge zufällig
rng = random.Random(42)
with open(RES / "rating_sheet.csv", "w", newline="") as f1, open(RES / "rating_key.csv", "w", newline="") as f2:
    w1, w2 = csv.writer(f1), csv.writer(f2)
    w1.writerow(["nr", "bild", "text_A", "text_B",
                 "A_korrekt_1-5", "A_relevant_1-5", "A_laenge_ok_ja_nein", "A_erfunden_ja_nein",
                 "B_korrekt_1-5", "B_relevant_1-5", "B_laenge_ok_ja_nein", "B_erfunden_ja_nein", "kommentar"])
    w2.writerow(["nr", "A_ist", "B_ist"])
    for i, r in enumerate(ok, 1):
        human = rng.choice(r["captions"])
        pair = [("KI", r["alt"]), ("Mensch", human)]
        rng.shuffle(pair)
        w1.writerow([i, f"data/vizwiz/val/{r['file']}", pair[0][1], pair[1][1]] + [""] * 9)
        w2.writerow([i, pair[0][0], pair[1][0]])

print("Metrik:", METRIC)
print(json.dumps(summary, indent=1, ensure_ascii=False))
