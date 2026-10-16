# Kaam Kotha Jobs: prototype

A zero-cost job portal prototype for Nepali communities in the UK and Australia. It pulls
entry-level jobs (care, restaurants, retail, cleaning, warehouse, security, delivery, hotels) from the
**Adzuna API** for a few key Nepali-community areas, tags pay against the minimum wage, and publishes
a static, mobile-friendly site that can be hosted free on Cloudflare Pages.

It is built on the seeding plan in `/workspace/research/kaam-kotha-job-seeding-plan.md`, which
covers licensed feeds rather than scraping, Adzuna attribution, `noindex` on aggregated job pages
and minimum-wage tagging.

```
config.json                 areas, industries, keywords, wage floors
scripts/adzuna_client.py    tiny Adzuna client (reads the key from the environment; counts every call)
scripts/fetch_jobs.py       fetch -> relevance filter -> pay/student tags -> SQLite (dedupe by Adzuna id)
scripts/build_site.py       SQLite -> site/data/jobs.json + site/jobs/<id>.html (noindex)
site/                       static front end (index.html, post-a-job.html, assets/, _headers, robots.txt)
.github/workflows/refresh-jobs.yml   cron fetch + build + deploy to Cloudflare Pages
data/                       jobs.sqlite, raw API responses, call log (created locally; git-ignored)
screenshots/                screenshots of the prototype
```

## Run locally

Requirements: Python 3.10+.

```bash
git clone https://github.com/roshangm1/kaam-kotha-jobs.git && cd kaam-kotha-jobs
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export ADZUNA_APP_ID=...            # your Adzuna application ID
export ADZUNA_APP_KEY=...            # never commit this; it is only read from the environment (.env is git-ignored)
python scripts/fetch_jobs.py --max-calls 64   # 64 API calls (2 countries x 4 areas x 8 industries)
python scripts/build_site.py
cd site && python -m http.server 8080       # open http://localhost:8080
```

To rebuild the database from the cached raw responses in `data/raw/` without using any API calls:

```bash
rm -f data/jobs.sqlite && python scripts/fetch_jobs.py --from-cache && python scripts/build_site.py
```

You can link straight to a filtered view, for example
`/index.html?country=gb&industry=care&area=reading&pay=meets_min&student=1&q=night`.

## What the pipeline does

1. **Fetch:** one Adzuna `search` call per country × area × industry: page 1, 50 results, ads
   no older than 30 days, using the `what_or` keywords and a radius around the area (`config.json`).
2. **Relevance filter:** the job *title* must match one of the eight industry patterns, and senior or
   off-target titles (manager, director, engineer, consultant, etc.) are dropped. Jobs can be reassigned
   to the industry their title actually matches.
3. **Dedupe:** by Adzuna id in SQLite. A job found by several queries keeps a list of all the
   matching industries and areas. The site build also collapses near-duplicates (the same title, employer
   and description listed under several ids or locations).
4. **Pay tag:** the minimum-wage floors are UK £12.71/hr (National Living Wage, 21+, April 2026)
   and AU A$26.44/hr (National Minimum Wage, 1 July 2026).
   - An explicit hourly rate in the advert ("£12.71 per hour") is used first.
   - Otherwise the Adzuna salary is used: under 100 is hourly; 100 to 999 is daily; 10,000 or more
     is annual, converted at 40 h/week, which is Adzuna's own annualisation convention.
     Figures from 1,000 to 9,999 are ambiguous, so they become `unknown`.
   - Adzuna-*predicted* salaries and placeholders (£0 or £1) are `unknown`.
   - The tags are:
     - `meets_min`
     - `check`: part of the range is below the floor, the figure is pro-rata or part-time, or it is an
       apprentice rate.
     - `below`: never published.
     - `unknown`
5. **Student-friendly:** Adzuna `contract_time=part_time`, or the text mentions part-time, casual,
   weekend, evening, flexible, zero-hours or pro-rata work.
6. **Expiry:** jobs not seen for 7 days, or created more than 35 days ago, are deleted on each run.

## Adzuna terms built into the front end

- Every displayed advert carries a **"Jobs by Adzuna"** label (minimum 124×28 px) in which the word
  *Adzuna* links to adzuna.co.uk (UK) or adzuna.com.au (AU), as Adzuna's terms require.
- **Apply** buttons always use Adzuna's `redirect_url`.
- Adzuna job pages (`/jobs/*`) carry `<meta name="robots" content="noindex, follow">` and an
  `X-Robots-Tag: noindex` header (`site/_headers`). They have no JobPosting schema, because Google
  doesn't allow incomplete descriptions. `sitemap.xml` lists only the home and post-a-job pages.
- Before going live, replace the CSS text label with Adzuna's official logo image, from the
  press page linked in their API terms.
- Adzuna's terms allow publishing listings with attribution, but they mention a 14-day trial for
  "other commercial use". Get written confirmation from Adzuna that Kaam Kotha counts as a publisher
  (seeding plan, risk 1).

## API-limit budget

The Adzuna defaults are 25 calls a minute, 250 a day, 1,000 a week and 2,500 a month.

| Item | Calls |
|---|---|
| One full refresh (2 countries × 4 areas × 8 industries) | 64 |
| Client pacing | 2.6 s between calls (about 23 a minute) |
| GitHub Actions schedule: every 2 days | about 15 runs × 64 ≈ **960 a month** |
| Daily refresh instead | about 30 × 64 ≈ 1,920 a month (fits, with little headroom) |
| Adding a 5th area per country | +16 per run |

Every call is appended to `data/api_calls.log` (timestamp, country, query and HTTP status, never the key).
`--max-calls` is a hard stop. A 401, 403 or 429 response aborts the run.

## Configure areas and industries

Edit `config.json`:

- `areas.gb` / `areas.au`: `slug`, display `name`, the Adzuna `where` text and `distance_km`.
- `industries`: `slug`, `name` and the per-country `what_or` keywords. Adzuna returns jobs matching
  *any* of the words. To change what counts as relevant, edit `TITLE_RE` and `EXCLUDE_RE` in
  `scripts/fetch_jobs.py`.
- `min_wage_hourly`: update every April (UK) and every July (AU).

Calls per run = (number of areas) × (number of industries), added up for each country.

## Deploy for free (GitHub Actions + Cloudflare Pages)

This repository is **public**, so it contains code only. The job database, raw API responses, call
logs and the generated site (`site/jobs/`, `site/data/`, `sitemap.xml`) are git-ignored, and the
workflow **never commits data back**. It rebuilds the site on each run and keeps the SQLite DB between
runs with `actions/cache`.

### 1. Add the two Adzuna repository secrets (required)

In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Name | Value |
|---|---|
| `ADZUNA_APP_ID` | your Adzuna application ID |
| `ADZUNA_APP_KEY` | your Adzuna application key |

Secrets aren't exposed to workflows triggered from forks, and the key is never printed or logged.
If either secret is missing, the workflow stops at once with a clear error and makes no API calls.

### 2. Free Cloudflare Pages deploy (optional; until then the site is uploaded as an artifact)

1. Create a free Cloudflare account. Go to **Workers & Pages → Create → Pages → Direct Upload**
   and create a project named **`kaam-kotha-jobs`**. You can upload any placeholder folder the first
   time.
2. Create an API token (**My Profile → API Tokens → Create Token → Custom token**) with the
   permission **Account · Cloudflare Pages · Edit**. Copy your **Account ID** from the dashboard
   sidebar.
3. Add two more repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Run the workflow: **Actions → refresh-jobs → Run workflow**. It then runs on its own every 2 days
   at 05:15 UTC. The site appears at `https://kaam-kotha-jobs.pages.dev`.
5. Optional custom domain: in the Pages project go to **Custom domains → Set up a custom domain**,
   enter for example `jobs.kaamkotha.com`, and add the CNAME it shows at your DNS provider. The
   nameservers don't need to move. That hostname already resolved to something (HTTP 526 on
   16 October 2026), so check what is using it first.

If the Cloudflare secrets aren't set, the deploy step is skipped. The built `site/` is then uploaded
as the workflow artifact `kaam-kotha-jobs-site` and kept for 3 days, so you can download and preview it.

`site/_headers` is applied by Cloudflare Pages. It adds `X-Robots-Tag: noindex` to all Adzuna job pages.

### Cost and limits

- **GitHub Actions:** free for public repositories. GitHub disables scheduled workflows in a public
  repo after **60 days without repository activity**. If that happens, re-enable the workflow from
  the Actions tab, or push any commit.
- **Cloudflare Pages:** the free plan allows 500 builds a month and 20,000 files per site. This site
  uses about 1,500 files per deploy and about 15 deploys a month.
- **Adzuna:** about 960 of the 2,500 free calls a month (see the budget above).
- **Running cost: £0 a month.**

## Known limitations (prototype)

- Only page 1 (up to 50 jobs) is fetched per query. Adzuna reports thousands more per query in
  London, Reading and Sydney.
- Most Australian Adzuna ads carry no salary, so about 84% of AU jobs show *Pay not stated*.
- The relevance and pay rules are heuristics. Annual figures are converted at 40 h/week, so the
  "≈ £x/hr" shown is approximate.
- The *Post a job free* form and the *Get the app* button are placeholders: nothing is submitted, and
  the button links to `link.kaamkotha.com/go`.
- `site/data/jobs.json` is about 0.9 MB, which is fine for a prototype. For the full build, move to
  Cloudflare D1 plus Pages Functions, as in the seeding plan §4.
- The Kaam Kotha logo is a placeholder (the "का" mark).
