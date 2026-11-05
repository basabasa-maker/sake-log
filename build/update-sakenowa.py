#!/usr/bin/env python3
"""さけのわデータを取り込み、data/sakenowa.json に圧縮保存する。月1回ほど実行する。"""
import json, subprocess, datetime, pathlib
B = "https://muro.sakenowa.com/sakenowa-data/api/"
def get(n):
    r = subprocess.run(["curl", "-s", "--fail", "-m", "60", B + n], capture_output=True, check=True)
    return json.loads(r.stdout)
brands = get("brands")["brands"]
breweries = get("breweries")["breweries"]
areas = get("areas")["areas"]
charts = get("flavor-charts")["flavorCharts"]
out = {
    "updated": datetime.date.today().isoformat(),
    "source": "https://sakenowa.com/",
    "areas": [[a["id"], a["name"]] for a in areas],
    "breweries": [[b["id"], b["name"], b["areaId"]] for b in breweries],
    "brands": [[b["id"], b["name"], b.get("breweryId") or 0] for b in brands],
    "charts": {str(c["brandId"]): [round(c["f%d" % i], 3) for i in range(1, 7)] for c in charts},
}
p = pathlib.Path(__file__).resolve().parent.parent / "data" / "sakenowa.json"
p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("saved", p, p.stat().st_size, "bytes", len(out["brands"]), "brands", len(out["charts"]), "charts")
