// Kaam Kotha Jobs: client-side search over cached Adzuna jobs + approved employer posts (/api/jobs)
(() => {
  const $ = id => document.getElementById(id);
  const PAGE = 30;
  const ICON = {care:'🩺',hospitality:'🍳',retail:'🛒',cleaning:'🧽',warehouse:'📦',security:'🛡️',delivery:'🚚',hotels:'🏨'};
  const PAY = {meets_min:['ok','✓ Min. wage+'], check:['warn','Check pay'], unknown:['','Pay not stated']};
  const CONTRACT = {full_time:'Full-time',part_time:'Part-time',casual:'Casual',temporary:'Temporary',contract:'Contract'};
  let DATA, JOBS = [], shown = PAGE;
  const params = new URLSearchParams(location.search);
  const state = {
    country: params.get('country') === 'au' ? 'au' : 'gb', q: params.get('q') || '', industry: params.get('industry') || '',
    area: params.get('area') || '', pay: params.get('pay') || '', student: params.get('student') === '1', direct: params.get('direct') === '1',
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ago = d => {
    if (!d) return '';
    const days = Math.floor((Date.now() - new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).getTime()) / 864e5);
    return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : new Date(d).toLocaleDateString('en-GB', {day:'numeric', month:'short'});
  };
  const filtersActive = () => state.q || state.industry || state.area || state.pay || state.student || state.direct;

  function syncUrl() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) p.set(k, v === true ? '1' : v);
    history.replaceState(null, '', p.toString() ? '?' + p : location.pathname);
  }

  function fromPost(p) {
    // Normalise an approved employer post from /api/jobs into the card shape
    const cur = DATA.meta.currency[p.country];
    const per = {hour:'an hour', week:'a week', year:'a year'}[p.pay_period];
    const amt = p.pay_period === 'year' ? Math.round(p.pay_amount).toLocaleString('en-GB') : Number(p.pay_amount).toFixed(2);
    let pt = `${cur}${amt} ${per}`;
    if (p.pay_period !== 'hour') pt += ` (≈ ${cur}${Number(p.hourly_equiv).toFixed(2)}/hr)`;
    return {direct: true, id: p.id, c: p.country, t: p.title, co: p.employer, l: `${p.town}, ${p.postcode}`,
      i: p.industry, is: [p.industry], a: [], p: 'meets_min', pt, s: p.student_friendly ? 1 : 0,
      d: p.description, dt: (p.approved_at || '').slice(0, 10), ct: CONTRACT[p.contract_type] || '', hrs: p.hours_per_week};
  }

  function chips() {
    const all = [{slug:'', name:'All jobs'}, ...DATA.meta.industries];
    $('chips').innerHTML = all.map(i => `<button type="button" class="chip" data-ind="${i.slug}" aria-pressed="${state.industry === i.slug}"><span class="ic" aria-hidden="true">${ICON[i.slug] || '✨'}</span>${esc(i.name)}</button>`).join('');
  }

  function fill() {
    const m = DATA.meta;
    $('area').innerHTML = '<option value="">All areas</option>' + m.areas[state.country].map(a => `<option value="${a.slug}">${esc(a.name)}</option>`).join('');
    if (!m.areas[state.country].some(a => a.slug === state.area)) state.area = '';
    $('area').value = state.area; $('q').value = state.q; $('pay').value = state.pay;
    $('student').checked = state.student; $('direct').checked = state.direct;
    document.querySelectorAll('[data-country]').forEach(b => b.setAttribute('aria-pressed', b.dataset.country === state.country));
    $('mw').textContent = `${m.currency[state.country]}${m.min_wage[state.country].toFixed(2)} (${state.country === 'gb' ? 'UK National Living Wage, 21+' : 'Australian National Minimum Wage'})`;
    $('foot-adzuna').href = m.adzuna[state.country];
    $('hidden-note').textContent = m.hidden_below_min ? `${m.hidden_below_min} adverts paying less than the minimum wage are hidden.` : '';
    chips();
  }

  function matches(j) {
    if (j.c !== state.country) return false;
    if (state.industry && !j.is.includes(state.industry)) return false;
    if (state.area && !j.direct && !j.a.includes(state.area)) return false;
    if (state.area && j.direct) return false; // employer posts aren't tagged to a community area yet
    if (state.pay === 'meets_min' && j.p !== 'meets_min') return false;
    if (state.pay === 'known' && j.p === 'unknown') return false;
    if (state.student && !j.s) return false;
    if (state.direct && !j.direct) return false;
    if (state.q) {
      const hay = (j.t + ' ' + j.co + ' ' + j.l + ' ' + j.d).toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  function card(j) {
    const ind = DATA.meta.industries.find(i => i.slug === j.i);
    const [cls, label] = PAY[j.p] || PAY.unknown;
    const href = j.direct ? `/jobs/p/${j.id}` : `/jobs/${j.id}`;
    const pills = [
      j.direct ? '<span class="pill brand">✓ Posted directly by employer</span>' : '',
      `<span class="pill ${cls}">${label}</span>`,
      j.s ? '<span class="pill info">🎓 Student-friendly</span>' : '',
      j.ct ? `<span class="pill">${esc(j.ct)}${j.hrs ? ` · ${j.hrs} hrs/wk` : ''}</span>` : '',
      ind ? `<span class="pill">${ICON[ind.slug]} ${esc(ind.name)}</span>` : '',
    ].join('');
    const foot = j.direct
      ? `<a class="btn btn-primary" href="${href}">View &amp; apply</a>`
      : `<a class="btn btn-primary" href="${esc(j.u)}" target="_blank" rel="nofollow noopener">Apply</a>
         <a class="adzuna" href="${DATA.meta.adzuna[j.c]}" target="_blank" rel="noopener" title="Jobs by Adzuna">Jobs by <b>Adzuna</b></a>`;
    return `<li class="job${j.direct ? ' direct' : ''}">
      <div class="job-top">
        <div class="avatar" aria-hidden="true">${ICON[j.i] || '💼'}</div>
        <div style="min-width:0">
          <h3><a href="${href}">${esc(j.t)}</a></h3>
          <div class="sub">${esc(j.co || 'Employer not named')} · ${esc(j.l)}</div>
        </div>
      </div>
      ${j.pt ? `<div class="pay">${esc(j.pt)}</div>` : ''}
      <p class="snippet">${esc(j.d)}</p>
      <div class="pills">${pills}</div>
      <div class="job-foot">${foot}<span class="date">${esc(ago(j.dt))}</span></div>
    </li>`;
  }

  function render(reset = true) {
    if (reset) shown = PAGE;
    const list = JOBS.filter(matches);
    $('count').textContent = `${list.length.toLocaleString('en-GB')} job${list.length === 1 ? '' : 's'}`;
    const ind = DATA.meta.industries.find(i => i.slug === state.industry);
    $('results-title').textContent = ind ? `${ind.name} jobs` : 'Latest jobs';
    $('list').innerHTML = list.slice(0, shown).map(card).join('') ||
      `<li class="empty"><div class="big" aria-hidden="true">🔍</div><h3>No jobs match those filters</h3>
       <p class="muted">Try removing a filter, or get alerts in the app when new jobs appear.</p>
       <p><button class="btn btn-ghost" type="button" onclick="document.getElementById('reset').click()">Clear filters</button>
       <a class="btn btn-primary" href="https://link.kaamkotha.com/go">Get job alerts</a></p></li>`;
    $('list').setAttribute('aria-busy', 'false');
    $('more').hidden = list.length <= shown;
    $('reset').hidden = !filtersActive();
    syncUrl();
  }

  function bind() {
    document.querySelectorAll('[data-country]').forEach(b => b.addEventListener('click', () => { state.country = b.dataset.country; state.area = ''; fill(); render(); }));
    $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.industry = b.dataset.ind; chips(); render(); });
    let t; $('q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150); });
    for (const k of ['area', 'pay']) $(k).addEventListener('change', e => { state[k] = e.target.value; render(); });
    for (const k of ['student', 'direct']) $(k).addEventListener('change', e => { state[k] = e.target.checked; render(); });
    $('more').addEventListener('click', () => { shown += PAGE; render(false); });
    $('reset').addEventListener('click', () => { Object.assign(state, {q:'', industry:'', area:'', pay:'', student:false, direct:false}); fill(); render(); });
  }

  Promise.all([
    fetch('/data/jobs.json').then(r => r.json()),
    fetch('/api/jobs').then(r => r.ok ? r.json() : {jobs: []}).catch(() => ({jobs: []})),
  ]).then(([d, posts]) => {
    DATA = d;
    const direct = (posts.jobs || []).map(fromPost);
    JOBS = [...direct, ...d.jobs];   // employer posts rank first
    $('stat-jobs').textContent = JOBS.length.toLocaleString('en-GB');
    $('stat-direct').textContent = direct.length.toLocaleString('en-GB');
    fill(); bind(); render();
  }).catch(() => { $('count').textContent = 'Could not load jobs.'; $('list').innerHTML = '<li class="empty"><div class="big">⚠️</div><h3>Jobs could not be loaded</h3><p class="muted">Please refresh the page.</p></li>'; });
})();
