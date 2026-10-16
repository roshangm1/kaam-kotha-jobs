"""Generate the static Kaam Kotha Jobs site from data/jobs.sqlite into site/.

Output:
  site/index.html, site/post-a-job.html, site/assets/*   (hand-written, kept in repo)
  site/data/jobs.json                                    (all publishable jobs)
  site/jobs/<id>.html                                    (one noindex page per Adzuna job)
  site/sitemap.xml                                       (home + post-a-job only; job pages are noindex)
Jobs tagged pay 'below' are never published (see seeding plan §4.6).
"""
import html, json, re, shutil, sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config.json").read_text())
SITE = ROOT / "site"
DB = ROOT / "data" / "jobs.sqlite"
BASE_URL = "https://jobs.kaamkotha.com"   # change when deployed

PAY_LABEL = {"meets_min": "Pays minimum wage or more", "check": "Check pay",
             "unknown": "Pay not stated"}


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def pay_text(j):
    cur = CFG["currency"][j["country"]]
    if j["pay_period"] == "unknown" or j["hourly_min"] is None:
        return ""
    if j["pay_period"] == "year":
        lo, hi = j["salary_min"] or j["salary_max"], j["salary_max"] or j["salary_min"]
        s = f"{cur}{lo:,.0f}" + (f"–{cur}{hi:,.0f}" if hi and hi != lo else "") + " a year"
        return s + f" (≈ {cur}{j['hourly_min']:.2f}/hr at full-time hours)"
    lo, hi = j["hourly_min"], j["hourly_max"]
    return f"{cur}{lo:.2f}" + (f"–{cur}{hi:.2f}" if hi and hi != lo else "") + " an hour"


def job_page(j, area_names, ind_names):
    e = html.escape
    dom = CFG["adzuna_domain"][j["country"]]
    floor = CFG["min_wage_hourly"][j["country"]]
    cur = CFG["currency"][j["country"]]
    badge = PAY_LABEL[j["pay_tag"]]
    return f"""<!doctype html>
<html lang="en-GB"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>{e(j['title'])} – {e(j['location'])} | Kaam Kotha Jobs</title>
<link rel="stylesheet" href="../assets/app.css">
</head><body>
<header class="top"><a class="brand" href="../index.html?country={j['country']}"><span class="logo">का</span><span>Kaam Kotha <b>Jobs</b></span></a></header>
<main class="wrap job-detail">
  <a class="back" href="../index.html?country={j['country']}">← All jobs</a>
  <h1>{e(j['title'])}</h1>
  <p class="meta">{e(j['company'] or 'Employer not named')} · {e(j['location'])}</p>
  <p class="tags"><span class="pay pay-{j['pay_tag']}">{badge}</span>
    {'<span class="tag">Student-friendly hours</span>' if j['student_friendly'] else ''}
    <span class="tag">{e(ind_names.get(j['industry'], j['industry']))}</span></p>
  {f'<p class="paytext">{e(pay_text(j))}</p>' if pay_text(j) else ''}
  <p class="desc">{e(clean(j['description']))}</p>
  <p class="small">Posted {e((j['created'] or '')[:10])}. Minimum-wage check uses {cur}{floor:.2f}/hr ({'UK National Living Wage, 21+' if j['country']=='gb' else 'Australian National Minimum Wage'}); awards, age and apprentice rates can differ. Always check the full advert.</p>
  <div class="actions">
    <a class="btn apply" href="{e(j['redirect_url'])}" rel="nofollow noopener" target="_blank">Read full advert &amp; apply</a>
    <a class="adzuna-badge" href="{dom}" rel="noopener" target="_blank" title="Jobs by Adzuna">Jobs by <span>Adzuna</span></a>
  </div>
  <aside class="cta"><b>Get job alerts in the Kaam Kotha app</b><span>New {e(ind_names.get(j['industry'], ''))} jobs near {e(area_names.get(j['area'], ''))}, straight to your phone.</span><a class="btn" href="https://link.kaamkotha.com/go">Get the app</a></aside>
</main>
<footer class="foot"><span>Job listings provided by <a href="{dom}">Adzuna</a>.</span><span>Kaam Kotha Jobs prototype.</span></footer>
</body></html>"""


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM jobs WHERE pay_tag != 'below' ORDER BY created DESC")]
    hidden = con.execute("SELECT count(*) FROM jobs WHERE pay_tag='below'").fetchone()[0]
    area_names = {a["slug"]: a["name"] for c in CFG["areas"].values() for a in c}
    ind_names = {i["slug"]: i["name"] for i in CFG["industries"]}

    jobs_dir = SITE / "jobs"
    shutil.rmtree(jobs_dir, ignore_errors=True)
    jobs_dir.mkdir(parents=True)
    (SITE / "data").mkdir(exist_ok=True)

    # Secondary dedupe: Adzuna sometimes lists the same advert under several ids/locations.
    seen, uniq = {}, []
    for j in rows:
        key = (j["country"], re.sub(r"\W+", " ", j["title"].lower()).strip(),
               (j["company"] or "").lower().strip(),
               clean(j["description"])[:120].lower())
        if key in seen:
            first = seen[key]
            first["industries"] = ",".join(sorted(set(first["industries"].split(",")) | set(j["industries"].split(","))))
            first["areas"] = ",".join(sorted(set(first["areas"].split(",")) | set(j["areas"].split(","))))
            continue
        seen[key] = j
        uniq.append(j)
    collapsed = len(rows) - len(uniq)
    rows = uniq

    out = []
    for j in rows:
        (jobs_dir / f"{j['id']}.html").write_text(job_page(j, area_names, ind_names))
        out.append({
            "id": j["id"], "c": j["country"], "t": j["title"], "co": j["company"], "l": j["location"],
            "i": j["industry"], "is": j["industries"].split(","), "a": j["areas"].split(","),
            "p": j["pay_tag"], "pt": pay_text(j), "s": j["student_friendly"],
            "d": clean(j["description"])[:220], "dt": (j["created"] or "")[:10],
            "u": j["redirect_url"],
        })
    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "areas": CFG["areas"], "industries": [{"slug": i["slug"], "name": i["name"]} for i in CFG["industries"]],
        "min_wage": CFG["min_wage_hourly"], "currency": CFG["currency"], "adzuna": CFG["adzuna_domain"],
        "hidden_below_min": hidden, "collapsed_duplicates": collapsed,
    }
    (SITE / "data" / "jobs.json").write_text(json.dumps({"meta": meta, "jobs": out}, ensure_ascii=False, separators=(",", ":")))
    (SITE / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{BASE_URL}/</loc></url>\n  <url><loc>{BASE_URL}/post-a-job.html</loc></url>\n</urlset>\n")
    print(f"Built {len(out)} job pages ({hidden} below-minimum jobs hidden, {collapsed} near-duplicates collapsed) -> {SITE}")


if __name__ == "__main__":
    main()
