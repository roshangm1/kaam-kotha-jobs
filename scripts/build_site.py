"""Generate the static Kaam Kotha Jobs site from data/jobs.sqlite into site/.

Output:
  site/index.html, site/post-a-job.html, site/assets/*   (hand-written, kept in repo)
  site/data/jobs.json                                    (all publishable jobs)
  site/jobs/<id>.html                                    (one noindex page per Adzuna job)
  (sitemap.xml is served dynamically by site/_worker.js)
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


HEAD_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">'
    '<link rel="stylesheet" href="/assets/app.css">')
ICON = {"care": "🩺", "hospitality": "🍳", "retail": "🛒", "cleaning": "🧽", "warehouse": "📦",
        "security": "🛡️", "delivery": "🚚", "hotels": "🏨"}
PAY_PILL = {"meets_min": ("ok", "✓ Min. wage+"), "check": ("warn", "Check pay"), "unknown": ("", "Pay not stated")}


def job_page(j, area_names, ind_names):
    """Aggregated (Adzuna) job page: noindex, Adzuna attribution, apply via redirect_url."""
    e = html.escape
    dom = CFG["adzuna_domain"][j["country"]]
    floor = CFG["min_wage_hourly"][j["country"]]
    cur = CFG["currency"][j["country"]]
    cls, label = PAY_PILL[j["pay_tag"]]
    ind = ind_names.get(j["industry"], j["industry"])
    pt = pay_text(j)
    country = "United Kingdom" if j["country"] == "gb" else "Australia"
    return f"""<!doctype html>
<html lang="en-GB"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, follow"><meta name="theme-color" content="#0b1f4d">
<title>{e(j['title'])} – {e(j['location'])} | Kaam Kotha Jobs</title>
{HEAD_LINKS}
</head><body>
<header class="nav"><div class="wrap"><a class="brand" href="/?country={j['country']}"><span class="mark" aria-hidden="true">का</span><span>Kaam Kotha Jobs<small>Real jobs, paid properly</small></span></a>
<div class="nav-actions"><a class="btn btn-ghost" href="https://link.kaamkotha.com/go">Get the app</a><a class="btn btn-primary" href="/post-a-job">Post a job free</a></div></div></header>
<main class="wrap narrow detail">
  <a class="crumb" href="/?country={j['country']}">← All {country} jobs</a>
  <article class="detail-card">
    <div class="job-top"><div class="avatar" aria-hidden="true">{ICON.get(j['industry'], '💼')}</div>
      <div class="pills" style="margin:0;align-self:center"><span class="pill {cls}">{label}</span>{'<span class="pill info">🎓 Student-friendly</span>' if j['student_friendly'] else ''}<span class="pill">{e(ind)}</span></div></div>
    <h1>{e(j['title'])}</h1>
    <div class="sub muted">{e(j['company'] or 'Employer not named')} · {e(j['location'])}</div>
    <div class="facts">
      <div class="fact"><span>Pay</span><b>{e(pt) if pt else 'Not stated'}</b></div>
      <div class="fact"><span>Industry</span><b>{ICON.get(j['industry'], '')} {e(ind)}</b></div>
      <div class="fact"><span>Posted</span><b>{e((j['created'] or '')[:10])}</b></div>
    </div>
    <h2 style="font-size:18px">Summary</h2>
    <div class="prose">{e(clean(j['description']))}</div>
    <div class="apply-box">
      <a class="btn btn-primary btn-lg" href="{e(j['redirect_url'])}" rel="nofollow noopener" target="_blank">Read full advert &amp; apply</a>
      <a class="adzuna" href="{dom}" rel="noopener" target="_blank" title="Jobs by Adzuna">Jobs by <b>Adzuna</b></a>
    </div>
    <p class="note" style="margin-top:16px">Minimum-wage check uses {cur}{floor:.2f}/hr ({'UK National Living Wage, 21+' if j['country']=='gb' else 'Australian National Minimum Wage'}); awards, age and apprentice rates can differ. Always check the full advert. Never pay anyone to get a job.</p>
  </article>
  <div class="panel app-panel" style="margin-top:16px"><h3>Get job alerts in the Kaam Kotha app</h3><p>New {e(ind.lower())} jobs near {e(area_names.get(j['area'], 'you'))}, straight to your phone.</p><a class="btn btn-primary" href="https://link.kaamkotha.com/go">Get the app</a></div>
</main>
<nav class="bottom-bar" aria-label="Apply"><a class="btn btn-primary" href="{e(j['redirect_url'])}" rel="nofollow noopener" target="_blank">Apply</a><a class="adzuna" href="{dom}" rel="noopener" target="_blank">Jobs by <b>Adzuna</b></a></nav>
<footer class="footer"><div class="wrap"><span>Job listing provided by <a class="adzuna" href="{dom}" rel="noopener" target="_blank">Jobs by <b>Adzuna</b></a></span><span><a href="/">All jobs</a></span></div></footer>
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
    # /sitemap.xml is generated dynamically by site/_worker.js (home, post-a-job, approved employer posts).
    (SITE / "sitemap.xml").unlink(missing_ok=True)
    print(f"Built {len(out)} job pages ({hidden} below-minimum jobs hidden, {collapsed} near-duplicates collapsed) -> {SITE}")


if __name__ == "__main__":
    main()
