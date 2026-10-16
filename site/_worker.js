// Kaam Kotha Jobs: Cloudflare Pages advanced-mode worker.
// Routes: /api/jobs (GET approved, POST new), /api/admin/* (Access-protected moderation),
// /admin (Access-protected UI), /jobs/p/<id> (indexable employer job pages), /sitemap.xml.
// Everything else is served from static assets (env.ASSETS).
// Bindings: DB (D1). Secrets: TURNSTILE_SECRET. Vars: ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAILS, TURNSTILE_SITEKEY, PUBLIC_HOST.

const BASE = 'https://jobs.kaamkotha.com';
const INDUSTRIES = {care:'Care & health',hospitality:'Restaurants & kitchens',retail:'Retail & grocery',cleaning:'Cleaning',warehouse:'Warehouse',security:'Security',delivery:'Delivery & driving',hotels:'Hotels'};
const ICON = {care:'🩺',hospitality:'🍳',retail:'🛒',cleaning:'🧽',warehouse:'📦',security:'🛡️',delivery:'🚚',hotels:'🏨'};
const CONTRACTS = {full_time:'Full-time',part_time:'Part-time',casual:'Casual',temporary:'Temporary',contract:'Contract'};
const GOOGLE_EMPLOYMENT = {full_time:'FULL_TIME',part_time:'PART_TIME',casual:'PART_TIME',temporary:'TEMPORARY',contract:'CONTRACTOR'};
const MIN_WAGE = {gb: 12.71, au: 26.44};
const MIN_WAGE_NAME = {gb: 'UK National Living Wage (21+)', au: 'Australian National Minimum Wage'};
const CUR = {gb: '£', au: 'A$'}, CUR_CODE = {gb: 'GBP', au: 'AUD'}, COUNTRY = {gb: 'United Kingdom', au: 'Australia'};
const PERIODS = {hour: 'HOUR', week: 'WEEK', year: 'YEAR'};
const LIVE_DAYS = 30;
const RATE_LIMIT_PER_HOUR = 10;

// ---------- helpers ----------
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra}});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso = () => new Date().toISOString();
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/<[^>]*>/g, '').trim().slice(0, max + 1);
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const money = (p) => {
  const cur = CUR[p.country];
  const amt = p.pay_period === 'year' ? Math.round(p.pay_amount).toLocaleString('en-GB') : Number(p.pay_amount).toFixed(2);
  let s = `${cur}${amt} ${{hour: 'an hour', week: 'a week', year: 'a year'}[p.pay_period]}`;
  if (p.pay_period !== 'hour') s += ` (≈ ${cur}${Number(p.hourly_equiv).toFixed(2)}/hr)`;
  return s;
};

// ---------- validation ----------
const PROTECTED = 'nepali|nepalese|gurkha|indian|pakistani|bangladeshi|sri lankan|filipino|filipina|chinese|asian|african|black|white|british|australian|aussie|european|eastern european|polish|romanian|arab|muslim|hindu|christian|sikh|buddhist|jewish|male|female|males|females|men|women|man|woman|girls?|boys?|ladies|gents|young|youngsters';
const AGE19 = '(19|[2-9]\\d)';
const DISCRIM = [
  // "Nepali only", "female preferred", "men wanted"
  new RegExp(`\\b(${PROTECTED})\\s+(only|preferred|wanted|required|needed|applicants only|candidates only|staff only|people only|workers only)\\b`, 'i'),
  // "only Nepali.", "only hiring women", "only Nepali candidates" (but not "only black trousers")
  new RegExp(`\\bonly\\s+(hiring\\s+|for\\s+|accepting\\s+)?(${PROTECTED})\\s*(candidates|applicants|staff|people|workers|need apply|can apply|please|[.!,;)]|$)`, 'im'),
  // "must be female", "must be under 30", "must be of Nepali origin"
  new RegExp(`\\bmust\\s+be\\s+(a\\s+|an\\s+)?(${PROTECTED}|under\\s+${AGE19}|aged?\\s+(between\\s+)?\\d{2}\\s*(-|–|to|and)|(of\\s+)?(nepali|indian|asian|british|australian|european)\\s+(origin|background|heritage|descent))\\b`, 'i'),
  /\b(age[ds]?|aged between|between the ages of)\s*:?\s*\d{2}\s*(-|–|to|and)\s*\d{2}\b/i,
  /\b\d{2}\s*(-|–|to)\s*\d{2}\s*(year[- ]olds|yrs? old|years old)\b/i,
  new RegExp(`\\b(under|below|younger than|not older than|max(imum)? age( of)?)\\s+${AGE19}\\s*(years|yrs|y\\/?o)?\\b(?!\\s*(hours|hrs|minutes|mins|miles|km))`, 'i'),
  /\b(no|not)\s+(foreigners|immigrants|migrants|indians|asians|africans|muslims|women|men|females|males|over\s*\d{2}s)\b/i,
  /\bnative\s+(english\s+)?speakers?\s+only\b/i,
  /\b(attractive|good[- ]looking|pretty)\s+(staff|girls?|boys?|people|candidates|applicants|women|men|ladies)\b/i,
  /\byoung\s+(girls?|boys?|staff|candidates|applicants|ladies|women|men)\b/i,
  /(नेपाली|पुरुष|महिला|केटी|केटा)\s*(मात्र|मात्रै)/,
];
const FEES = /\b(registration|joining|application|placement|agency|admin(istration)?|processing)\s+(fees?|charges?)\b|\bpay\s+(a\s+|an\s+)?(fee|deposit|upfront)|\bupfront\s+(payment|fee)/i;

function validate(raw) {
  const errors = {};
  const d = {
    title: clean(raw.title, 100), industry: clean(raw.industry, 20), employer: clean(raw.employer, 100),
    country: clean(raw.country, 2), town: clean(raw.town, 80), postcode: clean(raw.postcode, 10).toUpperCase().replace(/\s+/g, ' '),
    pay_amount: Number(raw.pay_amount), pay_period: clean(raw.pay_period, 5), hours_per_week: Number(raw.hours_per_week),
    contract_type: clean(raw.contract_type, 12), student_friendly: raw.student_friendly === true || raw.student_friendly === 'on' || raw.student_friendly === '1' || raw.student_friendly === 1,
    description: String(raw.description ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5001),
    apply_method: clean(raw.apply_method, 5), apply_value: clean(raw.apply_value, 300), contact_email: clean(raw.contact_email, 120).toLowerCase(),
    consent: raw.consent === true || raw.consent === 'on' || raw.consent === '1',
  };
  if (d.title.length < 3 || d.title.length > 100) errors.title = 'Enter a job title between 3 and 100 characters.';
  if (!INDUSTRIES[d.industry]) errors.industry = 'Choose one of the listed industries.';
  if (d.employer.length < 2 || d.employer.length > 100) errors.employer = 'Enter the employer or business name (2 to 100 characters).';
  if (!MIN_WAGE[d.country]) errors.country = 'Choose United Kingdom or Australia.';
  if (d.town.length < 2 || d.town.length > 80) errors.town = 'Enter the town or suburb.';
  if (d.country === 'gb' && !/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/.test(d.postcode)) errors.postcode = 'Enter a full UK postcode, e.g. GU11 1AA.';
  if (d.country === 'au' && !/^\d{4}$/.test(d.postcode)) errors.postcode = 'Enter a 4-digit Australian postcode, e.g. 2135.';
  if (!CONTRACTS[d.contract_type]) errors.contract_type = 'Choose the hours or contract type.';
  if (!PERIODS[d.pay_period]) errors.pay_period = 'Choose per hour, week or year.';
  if (!(d.hours_per_week >= 1 && d.hours_per_week <= 60)) errors.hours_per_week = 'Enter hours a week between 1 and 60.';
  if (!(d.pay_amount > 0 && d.pay_amount <= 1000000)) errors.pay_amount = 'Enter the pay as a number.';
  if (d.description.length < 80) errors.description = 'Add a fuller description (at least 80 characters) so people know what the job involves.';
  if (d.description.length > 5000) errors.description = 'Keep the description under 5,000 characters.';
  if (d.apply_method === 'email') { if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(d.apply_value)) errors.apply_value = 'Enter a valid email address for applications.'; }
  else if (d.apply_method === 'phone') { if (!/^[+\d\s()-]{8,25}$/.test(d.apply_value) || d.apply_value.replace(/\D/g, '').length < 8) errors.apply_value = 'Enter a valid phone number for applications.'; }
  else if (d.apply_method === 'url') { try { const u = new URL(d.apply_value); if (u.protocol !== 'https:' || !u.hostname.includes('.')) throw 0; } catch { errors.apply_value = 'Enter a web address starting https://'; } }
  else errors.apply_method = 'Choose how people should apply.';
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(d.contact_email)) errors.contact_email = 'Enter a valid contact email address.';
  if (!d.consent) errors.consent = 'Please confirm the statement before submitting.';

  // Minimum wage (hourly equivalent)
  if (!errors.pay_amount && !errors.pay_period && !errors.hours_per_week && MIN_WAGE[d.country]) {
    d.hourly_equiv = d.pay_period === 'hour' ? d.pay_amount : d.pay_period === 'week' ? d.pay_amount / d.hours_per_week : d.pay_amount / (52 * d.hours_per_week);
    d.hourly_equiv = Math.round(d.hourly_equiv * 100) / 100;
    if (d.hourly_equiv + 0.005 < MIN_WAGE[d.country]) {
      const c = d.country;
      errors.pay_amount = `This works out at about ${CUR[c]}${d.hourly_equiv.toFixed(2)} an hour, which is below the ${MIN_WAGE_NAME[c]} of ${CUR[c]}${MIN_WAGE[c].toFixed(2)} an hour. We can only list jobs that pay at least the minimum wage. Please check the pay or hours.`;
    }
  }
  // Fair hiring: no discriminatory requirements, no candidate fees
  const text = `${d.title}\n${d.description}`;
  if (DISCRIM.some(r => r.test(text))) {
    errors.description = 'Listings must be open to everyone. Please remove any requirement about nationality, ethnicity, religion, age or gender (for example "Nepali only"). You can still say which languages are useful for the job, such as "Nepali or Hindi speaking a plus".';
  } else if (FEES.test(text)) {
    errors.description = 'Listings can\'t ask candidates to pay a fee or deposit. Please remove that part.';
  }
  const fields = Object.keys(errors);
  const message = fields.length === 0 ? '' : (errors.description && /open to everyone|fee/.test(errors.description)) ? errors.description
    : errors.pay_amount && /minimum wage/.test(errors.pay_amount) ? errors.pay_amount : 'Please fix the highlighted fields.';
  return {data: d, errors, message};
}

async function verifyTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return {ok: false, reason: 'not-configured'};
  if (!token || token.length > 2048) return {ok: false, reason: 'missing'};
  const fd = new FormData();
  fd.append('secret', env.TURNSTILE_SECRET); fd.append('response', token); if (ip) fd.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method: 'POST', body: fd});
  const j = await r.json().catch(() => ({}));
  return {ok: !!j.success, reason: (j['error-codes'] || []).join(',')};
}

// ---------- Cloudflare Access JWT ----------
let JWKS = null, JWKS_AT = 0;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function accessIdentity(req, env) {
  const team = env.ACCESS_TEAM_DOMAIN, aud = env.ACCESS_AUD;
  if (!team || !aud) return null;
  let token = req.headers.get('cf-access-jwt-assertion');
  if (!token) { const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/); if (m) token = m[1]; }
  if (!token) return null;
  const parts = token.split('.'); if (parts.length !== 3) return null;
  let header, payload;
  try { header = JSON.parse(new TextDecoder().decode(b64u(parts[0]))); payload = JSON.parse(new TextDecoder().decode(b64u(parts[1]))); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  if (!JWKS || Date.now() - JWKS_AT > 3600e3 || !JWKS.some(k => k.kid === header.kid)) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!r.ok) return null;
    JWKS = (await r.json()).keys || []; JWKS_AT = Date.now();
  }
  const jwk = JWKS.find(k => k.kid === header.kid); if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud) || !(payload.exp > now) || (payload.nbf && payload.nbf > now + 60) || payload.iss !== `https://${team}`) return null;
  const allow = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (payload.email && allow.includes(String(payload.email).toLowerCase())) return {email: payload.email};
  // Service tokens (used only for automated tests) carry common_name instead of email; Access only issues them if the app has a Service Auth policy.
  if (!payload.email && payload.common_name) return {email: `service-token:${payload.common_name}`};
  return null;
}

// ---------- DB ----------
const PUBLIC_COLS = 'id,title,industry,employer,country,town,postcode,pay_amount,pay_period,hourly_equiv,hours_per_week,contract_type,student_friendly,description,apply_method,apply_value,approved_at,expires_at';
async function expireOld(env) {
  await env.DB.prepare("UPDATE posts SET status='expired', updated_at=?1 WHERE status='approved' AND expires_at <= ?1").bind(nowIso()).run();
}
async function insertPost(env, d, meta, status = 'pending') {
  const id = newId(), t = nowIso();
  await env.DB.prepare(`INSERT INTO posts (id,status,created_at,updated_at,title,industry,employer,country,town,postcode,pay_amount,pay_period,hourly_equiv,hours_per_week,contract_type,student_friendly,description,apply_method,apply_value,contact_email,ip_hash,user_agent)
    VALUES (?1,?2,?3,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)`)
    .bind(id, status, t, d.title, d.industry, d.employer, d.country, d.town, d.postcode, d.pay_amount, d.pay_period, d.hourly_equiv, d.hours_per_week,
      d.contract_type, d.student_friendly ? 1 : 0, d.description, d.apply_method, d.apply_value, d.contact_email, meta.ipHash, meta.ua).run();
  return id;
}

// ---------- public API ----------
async function apiListJobs(env) {
  await expireOld(env);
  const {results} = await env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM posts WHERE status='approved' AND expires_at > ?1 ORDER BY approved_at DESC LIMIT 500`).bind(nowIso()).all();
  const jobs = results.map(p => ({...p, description: p.description.slice(0, 240), apply_value: undefined, apply_method: undefined}));
  return json({jobs}, 200, {'cache-control': 'public, max-age=60'});
}

async function apiCreateJob(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || '';
  const ipHash = (await sha256(`kkjobs:${ip}`)).slice(0, 32);
  const ua = (req.headers.get('user-agent') || '').slice(0, 200);
  const log = outcome => env.DB.prepare('INSERT INTO submit_log (ip_hash, created_at, outcome) VALUES (?1, ?2, ?3)').bind(ipHash, nowIso(), outcome).run();
  if (Number(req.headers.get('content-length') || 0) > 32000) return json({ok: false, message: 'That submission is too large.'}, 413);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const {n} = await env.DB.prepare('SELECT count(*) AS n FROM submit_log WHERE ip_hash=?1 AND created_at > ?2').bind(ipHash, since).first();
  if (n >= RATE_LIMIT_PER_HOUR) return json({ok: false, message: 'Too many submissions from your connection. Please try again in an hour.'}, 429, {'retry-after': '3600'});
  let raw;
  try { raw = await req.json(); } catch { await log('bad_json'); return json({ok: false, message: 'Invalid request.'}, 400); }
  const {data, errors, message} = validate(raw || {});
  if (Object.keys(errors).length) { await log('invalid'); return json({ok: false, errors, message}, 422); }
  const ts = await verifyTurnstile(String(raw.turnstile_token || ''), ip, env);
  if (!ts.ok) { await log('turnstile'); return json({ok: false, errors: {turnstile: 'Please complete the "I am human" check again.'}, message: 'The spam check failed or expired. Please tick the "I am human" box and submit again.'}, 403); }
  const id = await insertPost(env, data, {ipHash, ua});
  await log('accepted');
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM submit_log WHERE created_at < ?1').bind(new Date(Date.now() - 7 * 864e5).toISOString()).run();
  return json({ok: true, id, status: 'pending', message: 'Thanks. Your job has been submitted and will appear once it has been checked.'}, 201);
}

// ---------- admin API ----------
async function apiAdmin(req, env, url, who) {
  const m = url.pathname.match(/^\/api\/admin\/jobs(?:\/([a-z0-9]{6,32}))?(?:\/(approve|reject|expire))?\/?$/);
  if (!m) return json({ok: false, message: 'Not found'}, 404);
  const [, id, action] = m;
  if (!id && req.method === 'GET') {
    await expireOld(env);
    const status = url.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected', 'expired', 'all'].includes(status)) return json({ok: false, message: 'Bad status'}, 400);
    const q = status === 'all' ? env.DB.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 200')
      : env.DB.prepare('SELECT * FROM posts WHERE status=?1 ORDER BY created_at DESC LIMIT 200').bind(status);
    const {results} = await q.all();
    const counts = {};
    for (const r of (await env.DB.prepare('SELECT status, count(*) AS n FROM posts GROUP BY status').all()).results) counts[r.status] = r.n;
    return json({ok: true, admin: who.email, counts, jobs: results.map(({ip_hash, ...r}) => r)});
  }
  if (!id && req.method === 'POST') {
    // Admin-created listing (e.g. a job taken by phone). Same validation; skips Turnstile and rate limit.
    let raw; try { raw = await req.json(); } catch { return json({ok: false, message: 'Invalid JSON'}, 400); }
    const {data, errors, message} = validate(raw || {});
    if (Object.keys(errors).length) return json({ok: false, errors, message}, 422);
    const newIdv = await insertPost(env, data, {ipHash: 'admin', ua: `admin:${who.email}`.slice(0, 200)});
    return json({ok: true, id: newIdv, status: 'pending'}, 201);
  }
  if (!id) return json({ok: false, message: 'Method not allowed'}, 405);
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id=?1').bind(id).first();
  if (!post) return json({ok: false, message: 'Not found'}, 404);
  const t = nowIso();
  if (req.method === 'DELETE' && !action) {
    await env.DB.prepare('DELETE FROM posts WHERE id=?1').bind(id).run();
    return json({ok: true, id, deleted: true});
  }
  if (req.method !== 'POST' || !action) return json({ok: false, message: 'Method not allowed'}, 405);
  let note = ''; try { note = clean((await req.json()).note, 500); } catch {}
  if (action === 'approve') {
    const exp = new Date(Date.now() + LIVE_DAYS * 864e5).toISOString();
    await env.DB.prepare("UPDATE posts SET status='approved', approved_at=?2, expires_at=?3, updated_at=?2, moderation_note=?4 WHERE id=?1").bind(id, t, exp, `approved by ${who.email}${note ? ': ' + note : ''}`).run();
  } else if (action === 'reject') {
    await env.DB.prepare("UPDATE posts SET status='rejected', updated_at=?2, moderation_note=?3 WHERE id=?1").bind(id, t, `rejected by ${who.email}${note ? ': ' + note : ''}`).run();
  } else if (action === 'expire') {
    await env.DB.prepare("UPDATE posts SET status='expired', expires_at=?2, updated_at=?2, moderation_note=?3 WHERE id=?1").bind(id, t, `expired by ${who.email}`).run();
  }
  const updated = await env.DB.prepare('SELECT * FROM posts WHERE id=?1').bind(id).first();
  delete updated.ip_hash;
  return json({ok: true, job: updated});
}

// ---------- HTML ----------
const HEAD = (title, extra = '') => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#0b1f4d">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/app.css?v=ba92b9485b">${extra}</head><body>
<header class="nav"><div class="wrap"><a class="brand" href="/"><img class="logo" src="/assets/kk-logo-160.webp?v=48634866ff" alt="" width="50" height="40"><span>Kaam Kotha Jobs<small>Real jobs, paid properly</small></span></a>
<div class="nav-actions"><a class="btn btn-ghost" href="https://link.kaamkotha.com/go">Get the app</a><a class="btn btn-primary" href="/post-a-job">Post a job free</a></div></div></header>`;
const FOOT = `<footer class="footer"><div class="wrap"><span>Kaam Kotha Jobs · <span lang="ne">काम कोठा</span></span><span><a href="/">All jobs</a> · <a href="/post-a-job">Post a job</a></span></div></footer></body></html>`;
const html = (body, status = 200, extra = {}) => new Response(body, {status, headers: {'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...extra}});

function messagePage(title, msg, status, extra = {}) {
  return html(`${HEAD(title, '<meta name="robots" content="noindex">')}<main class="wrap narrow detail"><div class="detail-card empty" style="border-style:solid">
  <div class="big" aria-hidden="true">${status === 410 ? '⌛' : status === 403 ? '🔒' : '🔍'}</div><h1 style="font-size:24px">${esc(title)}</h1><p class="muted">${msg}</p>
  <p><a class="btn btn-primary" href="/">Browse current jobs</a></p></div></main>${FOOT}`, status, extra);
}

function jobPage(p) {
  const c = p.country;
  const applyHref = p.apply_method === 'email' ? `mailto:${p.apply_value}?subject=${encodeURIComponent('Application: ' + p.title)}`
    : p.apply_method === 'phone' ? `tel:${p.apply_value.replace(/[^+\d]/g, '')}` : p.apply_value;
  const applyLabel = p.apply_method === 'email' ? `Apply by email` : p.apply_method === 'phone' ? `Call to apply` : 'Apply on employer website';
  const descHtml = esc(p.description).replace(/\n/g, '<br>');
  const ld = {
    '@context': 'https://schema.org/', '@type': 'JobPosting', title: p.title, description: `<p>${descHtml}</p><p>How to apply: ${esc(p.apply_method === 'url' ? p.apply_value : p.apply_value)}</p>`,
    identifier: {'@type': 'PropertyValue', name: 'Kaam Kotha Jobs', value: p.id},
    datePosted: p.approved_at, validThrough: p.expires_at, employmentType: GOOGLE_EMPLOYMENT[p.contract_type] || 'OTHER',
    hiringOrganization: {'@type': 'Organization', name: p.employer},
    jobLocation: {'@type': 'Place', address: {'@type': 'PostalAddress', addressLocality: p.town, postalCode: p.postcode, addressCountry: c === 'gb' ? 'GB' : 'AU'}},
    baseSalary: {'@type': 'MonetaryAmount', currency: CUR_CODE[c], value: {'@type': 'QuantitativeValue', value: Number(p.pay_amount), unitText: PERIODS[p.pay_period]}},
    industry: INDUSTRIES[p.industry], workHours: `${p.hours_per_week} hours per week`, directApply: false,
  };
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');
  const url = `${BASE}/jobs/p/${p.id}`;
  const metaDesc = `${p.title} at ${p.employer}, ${p.town} ${p.postcode}. ${money(p)}. ${p.description.slice(0, 110)}`;
  const posted = new Date(p.approved_at).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London'});
  const closes = new Date(p.expires_at).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London'});
  return html(`${HEAD(`${p.title} – ${p.employer}, ${p.town} | Kaam Kotha Jobs`, `
<meta name="description" content="${esc(metaDesc.slice(0, 300))}"><link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(p.title)} – ${esc(p.employer)}"><meta property="og:description" content="${esc(metaDesc.slice(0, 200))}"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:image" content="${BASE}/og-image.png"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ldJson}</script>`)}
<main class="wrap narrow detail">
  <a class="crumb" href="/?country=${c}">← All ${COUNTRY[c]} jobs</a>
  <article class="detail-card">
    <div class="job-top"><div class="avatar" aria-hidden="true">${ICON[p.industry] || '💼'}</div>
      <div class="pills" style="margin:0;align-self:center"><span class="pill brand">✓ Posted directly by employer</span><span class="pill ok">✓ Min. wage+</span>${p.student_friendly ? '<span class="pill info">🎓 Student-friendly</span>' : ''}</div></div>
    <h1>${esc(p.title)}</h1>
    <div class="sub muted">${esc(p.employer)} · ${esc(p.town)}, ${esc(p.postcode)} · ${COUNTRY[c]}</div>
    <div class="facts">
      <div class="fact"><span>Pay</span><b>${esc(money(p))}</b></div>
      <div class="fact"><span>Hours</span><b>${esc(CONTRACTS[p.contract_type])} · ${esc(p.hours_per_week)} hrs/week</b></div>
      <div class="fact"><span>Industry</span><b>${ICON[p.industry]} ${esc(INDUSTRIES[p.industry])}</b></div>
      <div class="fact"><span>Closes</span><b>${esc(closes)}</b></div>
    </div>
    <h2 style="font-size:18px">About the job</h2>
    <div class="prose">${descHtml}</div>
    <div class="apply-box">
      <a class="btn btn-primary btn-lg" href="${esc(applyHref)}" ${p.apply_method === 'url' ? 'target="_blank" rel="nofollow noopener"' : ''}>${applyLabel}</a>
      <span class="muted">${esc(p.apply_value)}</span>
    </div>
    <p class="note" style="margin-top:16px">Posted ${esc(posted)}. Checked by Kaam Kotha before publishing. Never pay an employer or agent to get a job; report anything suspicious to roshan@kaamkotha.com.</p>
  </article>
  <div class="panel app-panel" style="margin-top:16px"><h3>Get job alerts in the Kaam Kotha app</h3><p>New ${esc(INDUSTRIES[p.industry].toLowerCase())} jobs near you, straight to your phone.</p><a class="btn btn-primary" href="https://link.kaamkotha.com/go">Get the app</a></div>
</main>
<nav class="bottom-bar" aria-label="Apply"><a class="btn btn-primary" href="${esc(applyHref)}" ${p.apply_method === 'url' ? 'target="_blank" rel="nofollow noopener"' : ''}>${applyLabel}</a></nav>
${FOOT}`, 200, {'cache-control': 'public, max-age=300'});
}

async function employerJob(env, id) {
  if (!/^[a-z0-9]{6,32}$/.test(id)) return messagePage('Job not found', 'This job does not exist.', 404, {'x-robots-tag': 'noindex'});
  const p = await env.DB.prepare('SELECT * FROM posts WHERE id=?1').bind(id).first();
  if (!p || p.status === 'pending' || p.status === 'rejected') return messagePage('Job not found', 'This job does not exist or is not published.', 404, {'x-robots-tag': 'noindex'});
  if (p.status === 'expired' || !p.expires_at || p.expires_at <= nowIso()) return messagePage('This job has closed', 'The listing expired and is no longer accepting applications.', 410, {'x-robots-tag': 'noindex'});
  return jobPage(p);
}

async function sitemap(env) {
  const {results} = await env.DB.prepare("SELECT id, updated_at FROM posts WHERE status='approved' AND expires_at > ?1 ORDER BY approved_at DESC LIMIT 5000").bind(nowIso()).all();
  const urls = [`<url><loc>${BASE}/</loc><changefreq>daily</changefreq></url>`, `<url><loc>${BASE}/post-a-job</loc></url>`,
    ...results.map(r => `<url><loc>${BASE}/jobs/p/${r.id}</loc><lastmod>${r.updated_at.slice(0, 10)}</lastmod></url>`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    {headers: {'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600'}});
}

function adminPage(who) {
  return html(`${HEAD('Moderation – Kaam Kotha Jobs', '<meta name="robots" content="noindex, nofollow">')}
<main class="wrap detail" id="admin" data-admin="${esc(who.email)}">
  <div class="results-head"><h1 style="margin:0;font-size:26px">Job moderation</h1><span class="muted">Signed in as ${esc(who.email)} · <a href="/cdn-cgi/access/logout">Sign out</a></span></div>
  <p class="muted">New employer posts wait here as <b>pending</b>. Approve to publish for ${LIVE_DAYS} days; reject to hide. Contact emails are private.</p>
  <div class="tabs" id="tabs"></div>
  <div id="items"><div class="skeleton"><div class="sk" style="width:50%"></div><div class="sk" style="width:80%"></div></div></div>
</main>
<script src="/assets/admin.js?v=35053c4c69" defer></script>${FOOT}`, 200, {'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'});
}

// ---------- router ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/api/jobs' || p === '/api/jobs/') {
        if (req.method === 'GET') return await apiListJobs(env);
        if (req.method === 'POST') return await apiCreateJob(req, env);
        return json({ok: false, message: 'Method not allowed'}, 405, {allow: 'GET, POST'});
      }
      if (p === '/admin' || p === '/admin/' || p.startsWith('/api/admin')) {
        const who = await accessIdentity(req, env);
        if (!who) {
          if (p.startsWith('/api/')) return json({ok: false, message: 'Admin sign-in required.'}, 401);
          return messagePage('Admins only', `Sign in at <a href="${BASE}/admin">${BASE}/admin</a> with an approved email address.`, 403, {'cache-control': 'no-store', 'x-robots-tag': 'noindex'});
        }
        if (p.startsWith('/api/admin')) return await apiAdmin(req, env, url, who);
        return adminPage(who);
      }
      if (p.startsWith('/jobs/p/')) return await employerJob(env, p.slice(8).replace(/\/$/, ''));
      if (p === '/sitemap.xml') return await sitemap(env);
      if (p.startsWith('/api/')) return json({ok: false, message: 'Not found'}, 404);
    } catch (e) {
      console.error('worker error', p, e && e.message);
      return p.startsWith('/api/') ? json({ok: false, message: 'Server error. Please try again.'}, 500) : messagePage('Something went wrong', 'Please try again shortly.', 500);
    }
    // Static assets
    const res = await env.ASSETS.fetch(req);
    if (p.startsWith('/jobs/') || p.startsWith('/data/')) {
      // Aggregated (Adzuna) job pages and data must not be indexed
      const h = new Headers(res.headers);
      h.set('x-robots-tag', 'noindex');
      if (p.startsWith('/data/')) h.set('cache-control', 'public, max-age=900');
      return new Response(res.body, {status: res.status, statusText: res.statusText, headers: h});
    }
    return res;
  },
};
