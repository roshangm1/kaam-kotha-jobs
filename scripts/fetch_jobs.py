"""Fetch Kaam Kotha prototype jobs from Adzuna into SQLite.

Usage: python scripts/fetch_jobs.py [--max-calls N] [--countries gb,au]
Credentials: ADZUNA_APP_ID and ADZUNA_APP_KEY from the environment.
"""
import argparse, datetime, json, re, sqlite3, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from adzuna_client import search, AdzunaError

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config.json").read_text())
DB = ROOT / "data" / "jobs.sqlite"
RAW = ROOT / "data" / "raw"

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,            -- Adzuna id (dedupe key)
  country TEXT, title TEXT, company TEXT, location TEXT,
  industry TEXT,                  -- primary industry slug (first query that found it)
  industries TEXT,                -- comma list of all matching industry slugs
  area TEXT,                      -- primary area slug
  areas TEXT,                     -- comma list of all matching area slugs
  salary_min REAL, salary_max REAL, salary_is_predicted INTEGER,
  pay_period TEXT,                -- hour | day | year | unknown
  hourly_min REAL, hourly_max REAL,
  pay_tag TEXT,                   -- meets_min | check | below | unknown
  contract_time TEXT, contract_type TEXT, student_friendly INTEGER,
  description TEXT, category TEXT, created TEXT, redirect_url TEXT,
  first_seen TEXT, last_seen TEXT
);
CREATE TABLE IF NOT EXISTS fetch_runs (
  run_at TEXT, country TEXT, industry TEXT, area TEXT, status TEXT,
  returned INTEGER, new_jobs INTEGER, total_available INTEGER
);
"""

HOURLY_TEXT_RE = re.compile(
    r"(?:£|\$|A\$|AUD\s?)\s?(\d{1,2}(?:\.\d{1,2})?)\s*(?:-|–|to)?\s*(?:(?:£|\$|A\$)?\s?(\d{1,2}(?:\.\d{1,2})?))?\s*"
    r"(?:per hour|p/?h\b|/\s?hr\b|/\s?hour|an hour|ph\b|hourly)", re.I)
PART_TIME_RE = re.compile(r"\b(part[ -]?time|casual|weekend|evening|flexible hours|zero hours|pro[ -]?rata)\b", re.I)


def _tag(country, hmin, hmax, lenient_hmin=None):
    floor = CFG["min_wage_hourly"][country]
    if hmin > 4 * floor:  # implausible for these roles -> data error, do not show a badge
        return "unknown"
    if hmin >= floor - 0.005:
        return "meets_min"
    if hmax >= floor - 0.005 or (lenient_hmin is not None and lenient_hmin >= floor - 0.005):
        return "check"
    return "below"


def classify_pay(country, smin, smax, predicted, text, part_time):
    """Return (period, hourly_min, hourly_max, tag).

    Adzuna mixes hourly, daily and annual figures in salary_min/max, so the period is
    inferred from magnitude. Rules (deliberately cautious, never accuse an employer on a guess):
      * Adzuna-predicted salaries and placeholders (< 3) are treated as unknown.
      * Annual -> hourly uses standard full-time hours (40 h, Adzuna's annualisation convention) for 'meets_min';
        a job is only 'below' if it is still below at 35 h/week and is not part-time/pro-rata
        (part-time annual figures are often pro-rata, so those become 'check').
      * 1,000-9,999 (weekly/monthly ambiguity) -> unknown.
      * If no usable salary field, try an explicit hourly rate in the text ("£12.50 per hour").
    """
    m = HOURLY_TEXT_RE.search(text or "")
    if m:  # an explicit hourly rate in the advert beats Adzuna's annualised figure
        lo = float(m.group(1)); hi = max(lo, float(m.group(2) or lo))
        if 3 <= lo < 100:
            return "hour", lo, hi, _tag(country, lo, hi)
    vals = [v for v in (smin, smax) if v is not None and v >= 3]
    if vals and not predicted:
        lo, hi = min(vals), max(vals)
        hours = CFG["full_time_hours"][country]
        if hi < 100:
            return "hour", lo, hi, _tag(country, lo, hi)
        if hi < 1000:
            day = hours / 5
            return "day", round(lo / day, 2), round(hi / day, 2), _tag(country, lo / day, hi / day)
        if hi >= 10000:
            hmin, hmax = round(lo / (52 * hours), 2), round(hi / (52 * hours), 2)
            tag = _tag(country, hmin, hmax, lenient_hmin=lo / (52 * 35))
            if tag == "below" and part_time:
                tag = "check"
            if tag == "unknown":
                return "unknown", None, None, "unknown"
            return "year", hmin, hmax, tag
    return "unknown", None, None, "unknown"


TITLE_RE = {k: re.compile(v, re.I) for k, v in {
    "care": r"\b(care|carer|caring|support worker|hca|healthcare assistant|health care assistant|ain|pca|nursing assistant|disability|aged care|personal care|domiciliary|residential)\b",
    "hospitality": r"\b(chef|cook|kitchen|porter|barista|waiter|waitress|waiting|bartender|bar staff|front of house|foh|food|restaurant|cafe|café|catering|crew member|server|dishwasher)\b",
    "retail": r"\b(retail|customer assistant|sales assistant|store|shop|supermarket|cashier|checkout|team member|colleague|grocery|merchandis|night fill)",
    "cleaning": r"\b(clean|cleaner|cleaning|housekeep|janitor|domestic)",
    "warehouse": r"\b(warehouse|picker|packer|pick|pack|forklift|storeperson|storeman|operative|despatch|dispatch|loader|logistics assistant|production)",
    "security": r"\b(security|sia|door supervisor|cctv|guard|crowd control|patrol|concierge)",
    "delivery": r"\b(driver|courier|delivery|rider|van|multi[- ]?drop)",
    "hotels": r"\b(hotel|room attendant|housekeep|receptionist|night porter|concierge|guest services|front desk|night auditor)",
}.items()}
APPRENTICE_RE = re.compile(r"\b(apprentice|apprenticeship|trainee|under 21|16-17|school leaver)\b", re.I)
EXCLUDE_RE = re.compile(r"\b(architect|cyber|it support|manager|director|head of|consultant|engineer|registrar|analyst|executive|accountant|payroll|developer|lawyer|solicitor|surveyor|psychologist|physiotherapist|occupational therapist|nurse practitioner|doctor|gp|dentist|pharmacist|teacher|lecturer|coordinator|co-ordinator|specialist nurse|scientist|officer manager)\b", re.I)


def relevant_industry(title, queried):
    """Keep only entry-level roles whose *title* fits one of our industries.
    Prefer the industry we queried; otherwise reassign to the first matching one."""
    if EXCLUDE_RE.search(title):
        return None
    if TITLE_RE[queried].search(title):
        return queried
    for k, rx in TITLE_RE.items():
        if rx.search(title):
            return k
    return None


def upsert(con, country, ind, area, r, now):
    jid = str(r["id"])
    smin, smax = r.get("salary_min"), r.get("salary_max")
    predicted = str(r.get("salary_is_predicted", "0")) == "1"
    desc = r.get("description", "")
    title = r.get("title", "")
    ind = relevant_industry(title, ind)
    if ind is None:
        return None  # not an entry-level role in our target industries
    student = 1 if (r.get("contract_time") == "part_time" or PART_TIME_RE.search(desc + " " + title)) else 0
    period, hmin, hmax, tag = classify_pay(country, smin, smax, predicted, title + " " + desc, bool(student))
    if tag == "unknown":
        period, hmin, hmax = "unknown", None, None
    if tag == "below" and APPRENTICE_RE.search(title):
        tag = "check"  # apprentice / under-21 rates can lawfully be lower
    row = con.execute("SELECT industries, areas FROM jobs WHERE id=?", (jid,)).fetchone()
    if row:
        inds = set(row[0].split(",")) | {ind}
        areas = set(row[1].split(",")) | {area}
        con.execute("UPDATE jobs SET industries=?, areas=?, last_seen=? WHERE id=?",
                    (",".join(sorted(inds)), ",".join(sorted(areas)), now, jid))
        return False
    con.execute("""INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
        jid, country, r.get("title", "").strip(), (r.get("company") or {}).get("display_name", ""),
        (r.get("location") or {}).get("display_name", ""), ind, ind, area, area,
        smin, smax, int(predicted), period, hmin, hmax, tag,
        r.get("contract_time"), r.get("contract_type"), student, desc,
        (r.get("category") or {}).get("label", ""), r.get("created"), r.get("redirect_url"), now, now))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-calls", type=int, default=70)
    ap.add_argument("--countries", default="gb,au")
    ap.add_argument("--from-cache", action="store_true",
                    help="rebuild the DB from data/raw/*.json without calling the API")
    args = ap.parse_args()
    DB.parent.mkdir(exist_ok=True)
    RAW.mkdir(exist_ok=True)
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    calls = 0
    for country in args.countries.split(","):
        for area in CFG["areas"][country]:
            for ind in CFG["industries"]:
                if calls >= args.max_calls:
                    print(f"Stopping: reached --max-calls {args.max_calls}")
                    con.commit(); return
                label = f"{ind['slug']}@{area['slug']}"
                raw = RAW / f"{country}_{label.replace('@', '_')}.json"
                if args.from_cache:
                    if not raw.exists():
                        continue
                    d = json.loads(raw.read_text())
                    res = d.get("results", [])
                    outs = [upsert(con, country, ind["slug"], area["slug"], r, now) for r in res]
                    new = sum(1 for o in outs if o); dropped = sum(1 for o in outs if o is None)
                    print(f"[{country}] {label}: {len(res)} cached, {new} new, {dropped} filtered out as off-target")
                    continue
                try:
                    d = search(country, ind["what_or"][country], area["where"], area["distance_km"],
                               results_per_page=CFG["results_per_page"], max_days_old=CFG["max_days_old"], label=label)
                except AdzunaError as e:
                    calls += 1
                    print(f"[{country}] {label}: ERROR {e}")
                    con.execute("INSERT INTO fetch_runs VALUES (?,?,?,?,?,?,?,?)", (now, country, ind["slug"], area["slug"], f"error: {e}", 0, 0, 0))
                    if "HTTP 401" in str(e) or "HTTP 403" in str(e) or "HTTP 429" in str(e):
                        con.commit(); sys.exit(1)
                    continue
                calls += 1
                raw.write_text(json.dumps(d))
                res = d.get("results", [])
                outs = [upsert(con, country, ind["slug"], area["slug"], r, now) for r in res]
                new = sum(1 for o in outs if o)
                con.execute("INSERT INTO fetch_runs VALUES (?,?,?,?,?,?,?,?)", (now, country, ind["slug"], area["slug"], "ok", len(res), new, d.get("count", 0)))
                print(f"[{country}] {label}: {len(res)} returned, {new} new (of {d.get('count')} available)")
                con.commit()
    # expire anything not seen for 7 days or older than 35 days
    con.execute("DELETE FROM jobs WHERE last_seen < datetime('now','-7 days') OR created < datetime('now','-35 days')")
    con.commit()
    print(f"Done. API calls this run: {calls}")


if __name__ == "__main__":
    main()
