"""Ähnlichkeit AugmentAble ↔ Expertenkorrekturen (Methode wie im AccessGuru-Paper).

Text:  SBERT all-MiniLM-L6-v2, Kosinus, gemittelt über die verfügbaren Entwickler.
lang:  Jaccard der lang-Wert-Mengen.
Fallback ohne sentence-transformers: Token-F1 (im Ergebnis als 'metric' vermerkt).
"""
import json, re, statistics, sys
from pathlib import Path

RES = Path(__file__).resolve().parent.parent / "results"
data = json.loads((RES / "semantic.json").read_text())

try:
    from sentence_transformers import SentenceTransformer, util
    _m = SentenceTransformer("all-MiniLM-L6-v2")
    METRIC = "sbert-all-MiniLM-L6-v2-cosine"
    _cache = {}
    def text_sim(a, b):
        for s in (a, b):
            if s not in _cache:
                _cache[s] = _m.encode(s, convert_to_tensor=True)
        return float(util.cos_sim(_cache[a], _cache[b])[0][0])
except Exception as e:  # noqa
    print("⚠ sentence-transformers nicht verfügbar – Fallback Token-F1:", e, file=sys.stderr)
    METRIC = "token-f1 (fallback)"
    def text_sim(a, b):
        ta, tb = re.findall(r"\w+", a.lower()), re.findall(r"\w+", b.lower())
        if not ta and not tb:
            return 1.0
        common = sum(min(ta.count(t), tb.count(t)) for t in set(ta))
        if not common:
            return 0.0
        p, r = common / len(ta), common / len(tb)
        return 2 * p * r / (p + r)

def jaccard(a, b):
    a, b = set(a), set(b)
    return 1.0 if not a and not b else len(a & b) / len(a | b)

def joined(vals):
    return " | ".join(v for v in vals if v)

def sim(kind, mine, human):
    if kind == "set":
        return jaccard(mine, human)
    a, b = joined(mine), joined(human)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return text_sim(a, b)

out, by_type = [], {}
for it in data["items"]:
    f, kind = it["field"], it["kind"]
    humans = [h[f] for h in it["human"] if h and h.get(f) is not None]
    humans = [h for h in humans if h]  # leere Extraktion = Entwickler hat Element entfernt/nicht geliefert
    row = {"no": it["no"], "type": it["type"], "changed": it["changed"], "n_human": len(humans),
           "before": it["before"][f], "after": it["after"][f]}
    if humans:
        row["sim_before"] = statistics.mean(sim(kind, it["before"][f], h) for h in humans)
        row["sim_after"] = statistics.mean(sim(kind, it["after"][f], h) for h in humans)
        row["delta"] = row["sim_after"] - row["sim_before"]
        row["human"] = humans
    ai = it.get("ai")
    if ai and ai.get("alt") and humans:
        row["ai_alt"] = ai["alt"]
        row["ai_sim"] = statistics.mean(text_sim(ai["alt"], joined(h)) for h in humans)
    out.append(row)
    t = by_type.setdefault(it["type"], {"n": 0, "angefasst": 0, "besser": 0, "schlechter": 0, "sim_vorher": [], "sim_nachher": [], "ai_sim": []})
    t["n"] += 1
    t["angefasst"] += bool(it["changed"])
    if "delta" in row:
        t["sim_vorher"].append(row["sim_before"]); t["sim_nachher"].append(row["sim_after"])
        t["besser"] += row["delta"] > 0.05
        t["schlechter"] += row["delta"] < -0.05
    if "ai_sim" in row:
        t["ai_sim"].append(row["ai_sim"])

for t in by_type.values():
    for k in ("sim_vorher", "sim_nachher", "ai_sim"):
        t[k] = round(statistics.mean(t[k]), 3) if t[k] else None

(RES / "semantic_similarity.json").write_text(json.dumps({"metric": METRIC, "by_type": by_type, "items": out}, indent=1, ensure_ascii=False))
print("Metrik:", METRIC)
for k, v in by_type.items():
    print(f"{k:28s} n={v['n']:2d} angefasst={v['angefasst']:2d} besser={v['besser']:2d} schlechter={v['schlechter']:2d} "
          f"sim {v['sim_vorher']} → {v['sim_nachher']}  KI={v['ai_sim']}")
