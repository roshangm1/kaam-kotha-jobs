# Kaam Kotha Jobs

Live at **https://jobs.kaamkotha.com** (Cloudflare Pages project `kaam-kotha-jobs`).

A zero-cost job portal for Nepali communities in the UK and Australia. It combines two sources:

1. **Employer posts:** employers submit a job free at `/post-a-job`. Posts are stored in Cloudflare
   D1, checked by a person at `/admin`, and published for 30 days with a *Posted directly by employer*
   badge, ahead of aggregated jobs. Each approved post gets an indexable page at `/jobs/p/<id>` with
   schema.org `JobPosting` data.
2. **Aggregated jobs:** entry-level jobs (care, restaurants, retail, cleaning, warehouse, security,
   delivery, hotels) from the **Adzuna API** for key Nepali-community areas. Pay is tagged against the
   minimum wage and the jobs are published as static, `noindex` pages.

It is built on the seeding plan in `/workspace/research/kaam-kotha-job-seeding-plan.md`, which
covers licensed feeds rather than scraping, Adzuna attribution, `noindex` on aggregated job pages
and minimum-wage tagging.

```
config.json                 areas, industries, keywords, wage floors
scripts/adzuna_client.py    tiny Adzuna client (reads the key from the environment; counts every call)
scripts/fetch_jobs.py       fetch -> relevance filter -> pay/student tags -> SQLite (dedupe by Adzuna id)
scripts/build_site.py       SQLite -> site/data/jobs.json + site/jobs/<id>.html (noindex)
site/                       front end (index.html, post-a-job.html, assets/, _headers, robots.txt)
site/_worker.js             Pages advanced-mode worker: /api/jobs, /api/admin/*, /admin, /jobs/p/<id>, /sitemap.xml
wrangler.toml               Pages config: D1 binding + public vars (no secrets)
migrations/0001_init.sql    D1 schema (posts, submit_log)
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
cd site && python -m http.server 8080       # static only: open http://localhost:8080
```

To run the full site locally, including the job-post API and a local D1 database:

```bash
printf 'TURNSTILE_SECRET=1x0000000000000000000000000000000AA\n' > .dev.vars   # Turnstile's always-pass test secret
npx wrangler d1 migrations apply kaam-kotha-jobs --local
npx wrangler pages dev                       # http://localhost:8788
```

`.dev.vars` and `.wrangler/` are git-ignored. The form's site key only works on the live domains, so
test locally with curl, or use Turnstile's test site key `1x00000000000000000000AA` in `assets/post.js`.

To rebuild the database from the cached raw responses in `data/raw/` without using any API calls:

```bash
rm -f data/jobs.sqlite && python scripts/fetch_jobs.py --from-cache && python scripts/build_site.py
```

You can link straight to a filtered view, for example
`/?country=gb&industry=care&area=reading&pay=meets_min&student=1&direct=1&q=night`.

## Employer job posts

| Route | What it does |
|---|---|
| `GET /post-a-job` | Multi-section form with inline validation, a live preview card and Cloudflare Turnstile |
| `POST /api/jobs` | Validates, rate-limits (10 attempts an hour per hashed IP), verifies Turnstile, stores as `pending` |
| `GET /api/jobs` | Approved, unexpired posts (no private fields); the homepage merges these first |
| `GET /jobs/p/<id>` | Indexable job page with `JobPosting` JSON-LD; 404 if pending or rejected, 410 once expired |
| `GET /sitemap.xml` | Home, post-a-job and every live employer post (generated on request) |
| `GET /admin` | Moderation UI (Cloudflare Access) |
| `GET /api/admin/jobs?status=pending\|approved\|rejected\|expired\|all` | List posts, including the private contact email |
| `POST /api/admin/jobs` | Admin-created post (e.g. a job taken by phone). Same validation, no Turnstile |
| `POST /api/admin/jobs/<id>/approve\|reject\|expire` | Approve (live for 30 days), reject (optional `{"note": ...}`) or expire now |
| `DELETE /api/admin/jobs/<id>` | Delete permanently |

**Server-side rules** (`validate()` in `site/_worker.js`):

- Required fields and length limits. UK or Australian postcode format. Apply method is an email
  address, a phone number or an `https://` URL.
- **Minimum wage:** the hourly equivalent is the pay ÷ hours a week (weekly pay) or ÷ (52 × hours a
  week) (annual pay). It must be at least UK £12.71 or AU A$26.44, otherwise the post is rejected with
  a message that explains the calculation.
- **Open to everyone:** requirements about nationality, ethnicity, religion, age or gender are
  rejected, for example "Nepali only", "female preferred", "age 18-30", "must be under 30" or
  "नेपाली मात्र". Language skills ("Nepali or Hindi speaking a plus"), "fluent English required" and
  "must be over 18" are allowed.
- Candidate fees ("registration fee", "pay a deposit") are rejected.
- Validation runs before the Turnstile check, so the employer sees field errors straight away.
- The contact email is private. It appears only in the admin view, never in `/api/jobs` or on the
  public page. Only the chosen apply method is shown publicly.
- No emails are sent. The employer sees an on-screen confirmation with a reference number.

**Moderating (for Roshan):** open **https://jobs.kaamkotha.com/admin**. Cloudflare Access asks for
your email and sends a one-time PIN. Only `roshan@kaamkotha.com` and `roosan.gm@gmail.com` are
allowed. Sessions last 24 hours. The worker also verifies the Access JWT (signature, audience, issuer,
expiry and email allowlist), so `/admin` on `*.pages.dev` refuses access.

### Setting it up from scratch (all on the free tier)

1. **D1:** `npx wrangler d1 create kaam-kotha-jobs`. Put the id in `wrangler.toml`, then run
   `npx wrangler d1 migrations apply kaam-kotha-jobs --remote`. In the Pages project, bind it as `DB`
   for production and preview (**Settings → Bindings**).
2. **Turnstile:** in the dashboard go to **Turnstile → Add widget**. Choose mode *Managed* and add
   the domains `jobs.kaamkotha.com` and `kaam-kotha-jobs.pages.dev`. Put the site key in
   `wrangler.toml` (`TURNSTILE_SITEKEY`) and `site/assets/post.js`. Store the secret only as a Pages
   secret: `npx wrangler pages secret put TURNSTILE_SECRET --project-name kaam-kotha-jobs`.
3. **Cloudflare Access** (Zero Trust, free for up to 50 users):
   - Go to **Access → Applications → Add → Self-hosted**.
   - Add the destinations `jobs.kaamkotha.com/admin` and `jobs.kaamkotha.com/api/admin`.
   - Set the identity provider to *One-time PIN*.
   - Add an Allow policy that includes the two admin emails.
   - Copy the application's **AUD tag** into `ACCESS_AUD` and your team domain into
     `ACCESS_TEAM_DOMAIN`, both in `wrangler.toml`.
4. Deploy: `npx wrangler pages deploy` (it reads `wrangler.toml`), or let the workflow do it.

`wrangler.toml` is the source of truth for bindings and public variables on every
`wrangler pages deploy`. Secrets live only in Cloudflare.

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
- Adzuna job pages (`/jobs/<id>`) carry `<meta name="robots" content="noindex, follow">` and an
  `X-Robots-Tag: noindex` header, set by `site/_worker.js`. They have no JobPosting schema, because
  Google doesn't allow incomplete descriptions. The dynamic `sitemap.xml` lists only the home page,
  post-a-job and approved employer posts (`/jobs/p/<id>`), which are indexable.
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
logs and the generated site (`site/jobs/`, `site/data/`) are git-ignored, and the
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

1. The Pages project **`kaam-kotha-jobs`** already exists (Direct Upload) with the D1 binding,
   variables and Turnstile secret described above. For a fresh account, create it under
   **Workers & Pages → Create → Pages → Direct Upload**.
2. Create an API token (**My Profile → API Tokens → Create Token → Custom token**) with the
   permissions **Account · Cloudflare Pages · Edit** and **Account · D1 · Edit** (needed for the D1
   binding in `wrangler.toml`). Copy your **Account ID** from the dashboard sidebar.
3. Add two more repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Run the workflow: **Actions → refresh-jobs → Run workflow**. It then runs on its own every 2 days
   at 05:15 UTC. `wrangler pages deploy site` uploads the static files and `site/_worker.js`, and
   keeps the D1 binding from `wrangler.toml`.
5. Custom domain: **https://jobs.kaamkotha.com** is connected and live (proxied CNAME
   `jobs → kaam-kotha-jobs.pages.dev`, Google-issued certificate). It also works at
   `https://kaam-kotha-jobs.pages.dev`, except for `/admin`, which is only available on the custom
   domain because Access protects it there.

If the Cloudflare secrets aren't set, the deploy step is skipped. The built `site/` is then uploaded
as the workflow artifact `kaam-kotha-jobs-site` and kept for 3 days, so you can download and preview it.

**Caching:** `scripts/build_site.py` adds `?v=<content hash>` to every `/assets/*` reference in
`index.html`, `post-a-job.html`, `_worker.js` and the generated job pages, rewriting them in place.
This lets `/assets/*` be cached for a year (`immutable`): a changed file gets a new URL on the next
build, so deploys never serve stale CSS or JS. HTML keeps the Pages default (`max-age=0,
must-revalidate`).

**Brand and sharing:** the header logo is `site/assets/kk-logo-160.webp`, made from the Kaam Kotha
KK monogram. The favicons (`favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`,
`icon-192/512.png`, `site.webmanifest`) are generated from the same logo. The homepage and
post-a-job carry Open Graph and Twitter tags pointing at `/og-image.png` (1200×630 launch image).

`site/_headers` sets security and caching headers for static files. The worker adds
`X-Robots-Tag: noindex` to Adzuna job pages and `/data/*`.

### Cost and limits

- **GitHub Actions:** free for public repositories. GitHub disables scheduled workflows in a public
  repo after **60 days without repository activity**. If that happens, re-enable the workflow from
  the Actions tab, or push any commit.
- **Cloudflare Pages:** the free plan allows 500 builds a month and 20,000 files per site. This site
  uses about 1,500 files per deploy and about 15 deploys a month.
- **Adzuna:** about 960 of the 2,500 free calls a month (see the budget above).
- **Workers/Pages Functions:** free plan, 100,000 requests a day. Only `/api/*`, `/admin`,
  `/jobs/p/*` and `/sitemap.xml` do real work; the rest are served as static files.
- **D1:** free plan, 5 GB storage, 5 million rows read and 100,000 rows written a day.
- **Turnstile and Access:** free (Access is free for up to 50 users).
- **Running cost: £0 a month.**

## Known limitations (prototype)

- Only page 1 (up to 50 jobs) is fetched per query. Adzuna reports thousands more per query in
  London, Reading and Sydney.
- Most Australian Adzuna ads carry no salary, so about 84% of AU jobs show *Pay not stated*.
- The relevance and pay rules are heuristics. Annual figures are converted at 40 h/week, so the
  "≈ £x/hr" shown is approximate.
- The *Get the app* button links to `link.kaamkotha.com/go`.
- No emails are sent, either to employers (approval or rejection) or to admins (new pending post).
  Check `/admin` regularly.
- Expiry happens when the data is read, on `/api/jobs`, `/admin` and job pages, because Pages has no
  cron triggers.
- Employer posts aren't tied to a community area yet, so the *area* filter hides them.
- The fair-hiring filter is keyword-based. It catches the common phrasings, not every one, so human
  moderation is still the final check.
- Adzuna jobs still come from `site/data/jobs.json` (about 0.9 MB) rather than D1.
- The Kaam Kotha logo is a placeholder (the "का" mark).
