// Kaam Kotha Jobs prototype: client-side filtering over data/jobs.json
(() => {
  const $ = id => document.getElementById(id);
  const PAGE = 30;
  const PAY_LABEL = {meets_min: 'Pays minimum wage or more', check: 'Check pay', unknown: 'Pay not stated'};
  let DATA, shown = PAGE;
  const params = new URLSearchParams(location.search);
  const state = {
    country: params.get('country') || 'gb', q: params.get('q') || '', industry: params.get('industry') || '',
    area: params.get('area') || '', pay: params.get('pay') || '', student: params.get('student') === '1',
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function syncUrl() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v && !(k === 'student' && !v)) p.set(k, v === true ? '1' : v);
    history.replaceState(null, '', '?' + p.toString());
  }

  function fillSelects() {
    const m = DATA.meta;
    $('industry').innerHTML = '<option value="">All industries</option>' +
      m.industries.map(i => `<option value="${i.slug}">${esc(i.name)}</option>`).join('');
    $('area').innerHTML = '<option value="">All areas</option>' +
      m.areas[state.country].map(a => `<option value="${a.slug}">${esc(a.name)}</option>`).join('');
    if (!m.areas[state.country].some(a => a.slug === state.area)) state.area = '';
    $('industry').value = state.industry; $('area').value = state.area;
    $('q').value = state.q; $('pay').value = state.pay; $('student').checked = state.student;
    document.querySelectorAll('.country button').forEach(b => b.setAttribute('aria-selected', b.dataset.country === state.country));
    const cur = m.currency[state.country];
    $('mw').textContent = `${cur}${m.min_wage[state.country].toFixed(2)} (${state.country === 'gb' ? 'UK National Living Wage, 21+' : 'Australian National Minimum Wage'})`;
    const az = m.adzuna[state.country];
    $('foot-adzuna').href = az;
    $('hidden-note').textContent = DATA.meta.hidden_below_min ?
      `${DATA.meta.hidden_below_min} jobs advertising less than the minimum wage are hidden.` : '';
  }

  function matches(j) {
    if (j.c !== state.country) return false;
    if (state.industry && !j.is.includes(state.industry)) return false;
    if (state.area && !j.a.includes(state.area)) return false;
    if (state.pay === 'meets_min' && j.p !== 'meets_min') return false;
    if (state.pay === 'known' && j.p === 'unknown') return false;
    if (state.student && !j.s) return false;
    if (state.q) {
      const hay = (j.t + ' ' + j.co + ' ' + j.l + ' ' + j.d).toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  function card(j) {
    const ind = DATA.meta.industries.find(i => i.slug === j.i);
    const az = DATA.meta.adzuna[j.c];
    return `<li class="card">
      <a class="title" href="jobs/${j.id}.html">${esc(j.t)}</a>
      <p class="meta">${esc(j.co || 'Employer not named')} · ${esc(j.l)}</p>
      <p class="tags"><span class="pay pay-${j.p}">${PAY_LABEL[j.p]}</span>${j.s ? '<span class="tag">Student-friendly hours</span>' : ''}<span class="tag">${esc(ind ? ind.name : j.i)}</span></p>
      ${j.pt ? `<p class="paytext">${esc(j.pt)}</p>` : ''}
      <p class="desc">${esc(j.d)}…</p>
      <div class="actions">
        <a class="btn apply" href="${esc(j.u)}" target="_blank" rel="nofollow noopener">Apply</a>
        <a class="adzuna-badge" href="${az}" target="_blank" rel="noopener" title="Jobs by Adzuna">Jobs by <span>Adzuna</span></a>
        <span class="date">${esc(j.dt)}</span>
      </div></li>`;
  }

  function render(reset = true) {
    if (reset) shown = PAGE;
    const list = DATA.jobs.filter(matches);
    $('count').textContent = `${list.length.toLocaleString('en-GB')} jobs`;
    $('list').innerHTML = list.slice(0, shown).map(card).join('') ||
      '<li class="empty">No jobs match. Try fewer filters, or get alerts in the Kaam Kotha app.</li>';
    $('more').hidden = list.length <= shown;
    syncUrl();
  }

  function bind() {
    document.querySelectorAll('.country button').forEach(b => b.addEventListener('click', () => {
      state.country = b.dataset.country; state.area = ''; fillSelects(); render();
    }));
    let t;
    $('q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150); });
    for (const k of ['industry', 'area', 'pay']) $(k).addEventListener('change', e => { state[k] = e.target.value; render(); });
    $('student').addEventListener('change', e => { state.student = e.target.checked; render(); });
    $('more').addEventListener('click', () => { shown += PAGE; render(false); });
  }

  fetch('data/jobs.json').then(r => r.json()).then(d => { DATA = d; fillSelects(); bind(); render(); })
    .catch(() => { $('count').textContent = 'Could not load jobs.'; });
})();
