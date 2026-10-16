// Post-a-job form: inline validation, live preview, Turnstile, POST /api/jobs
(() => {
  const SITEKEY = '0x4AAAAAAFYfN0sS1pTkSFRn';
  const MIN = {gb: 12.71, au: 26.44}, CUR = {gb: '£', au: 'A$'};
  const MW = {gb: 'UK National Living Wage, 21+', au: 'Australian National Minimum Wage'};
  const ICON = {care:'🩺',hospitality:'🍳',retail:'🛒',cleaning:'🧽',warehouse:'📦',security:'🛡️',delivery:'🚚',hotels:'🏨'};
  const CONTRACT = {full_time:'Full-time',part_time:'Part-time',casual:'Casual',temporary:'Temporary',contract:'Contract'};
  const APPLY = {email:['Email address for applications','jobs@yourbusiness.co.uk','email'], phone:['Phone number for applications','07700 900123','tel'], url:['Application web page (https://…)','https://yourbusiness.co.uk/careers','url']};
  const f = document.getElementById('post-form');
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const touched = new Set();
  let token = '', widget;

  const val = () => {
    const d = Object.fromEntries(new FormData(f));
    d.student_friendly = $('student_friendly').checked; d.consent = $('consent').checked;
    return d;
  };
  const hourly = d => {
    const a = parseFloat(d.pay_amount), h = parseFloat(d.hours_per_week);
    if (!(a > 0)) return null;
    if (d.pay_period === 'hour') return a;
    if (!(h > 0)) return null;
    return d.pay_period === 'week' ? a / h : a / (52 * h);
  };

  function check(d) {
    const e = {}, c = d.country;
    const t = (d.title || '').trim(); if (t.length < 3) e.title = 'Enter a job title (at least 3 characters).';
    if (!d.industry) e.industry = 'Choose an industry.';
    if (!d.contract_type) e.contract_type = 'Choose the hours or contract type.';
    const ds = (d.description || '').trim(); if (ds.length < 80) e.description = `Add a bit more detail (${80 - ds.length} more characters needed).`;
    if ((d.employer || '').trim().length < 2) e.employer = 'Enter the employer or business name.';
    if ((d.town || '').trim().length < 2) e.town = 'Enter the town or suburb.';
    const pc = (d.postcode || '').trim();
    if (c === 'gb' && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(pc)) e.postcode = 'Enter a full UK postcode, e.g. GU11 1AA.';
    if (c === 'au' && !/^\d{4}$/.test(pc)) e.postcode = 'Enter a 4-digit Australian postcode, e.g. 2135.';
    const h = parseFloat(d.hours_per_week); if (!(h >= 1 && h <= 60)) e.hours_per_week = 'Enter hours a week between 1 and 60.';
    const hr = hourly(d);
    if (!(parseFloat(d.pay_amount) > 0)) e.pay_amount = 'Enter the pay.';
    else if (hr !== null && hr + 0.005 < MIN[c]) e.pay_amount = `That works out at ${CUR[c]}${hr.toFixed(2)} an hour, below the ${CUR[c]}${MIN[c].toFixed(2)} minimum wage.`;
    const av = (d.apply_value || '').trim();
    if (d.apply_method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(av)) e.apply_value = 'Enter a valid email address.';
    if (d.apply_method === 'phone' && (av.replace(/\D/g, '').length < 8 || !/^[+\d\s()-]+$/.test(av))) e.apply_value = 'Enter a valid phone number.';
    if (d.apply_method === 'url' && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(av)) e.apply_value = 'Enter a web address starting https://';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d.contact_email || '').trim())) e.contact_email = 'Enter a valid email address.';
    if (!d.consent) e.consent = 'Please confirm the statement above.';
    return e;
  }

  function show(errs, all) {
    document.querySelectorAll('.fld[data-f]').forEach(el => {
      const k = el.dataset.f, msg = errs[k];
      const on = msg && (all || touched.has(k));
      el.classList.toggle('invalid', !!on);
      const s = el.querySelector('.err'); if (s) s.textContent = on ? msg : '';
      const inp = el.querySelector('input,select,textarea'); if (inp) inp.setAttribute('aria-invalid', on ? 'true' : 'false');
    });
  }

  function preview(d) {
    const c = d.country, cur = CUR[c], hr = hourly(d);
    const per = {hour:'an hour', week:'a week', year:'a year'}[d.pay_period];
    const amt = parseFloat(d.pay_amount);
    let pay = amt > 0 ? `${cur}${d.pay_period === 'year' ? Math.round(amt).toLocaleString('en-GB') : amt.toFixed(2)} ${per}` : '';
    if (pay && d.pay_period !== 'hour' && hr) pay += ` (≈ ${cur}${hr.toFixed(2)}/hr)`;
    $('preview').innerHTML = `<div class="job-top"><div class="avatar" aria-hidden="true">${ICON[d.industry] || '💼'}</div>
      <div style="min-width:0"><h3>${esc(d.title || 'Your job title')}</h3>
      <div class="sub">${esc(d.employer || 'Your business')} · ${esc(d.town || 'Town')}${d.postcode ? ', ' + esc(d.postcode.toUpperCase()) : ''}</div></div></div>
      ${pay ? `<div class="pay">${esc(pay)}</div>` : ''}
      <p class="snippet">${esc(d.description || 'Your description will appear here.')}</p>
      <div class="pills"><span class="pill brand">✓ Posted directly by employer</span>
      ${hr && hr + 0.005 >= MIN[c] ? '<span class="pill ok">✓ Min. wage+</span>' : ''}
      ${d.student_friendly ? '<span class="pill info">🎓 Student-friendly</span>' : ''}
      ${d.contract_type ? `<span class="pill">${CONTRACT[d.contract_type]}${d.hours_per_week ? ` · ${esc(d.hours_per_week)} hrs/wk` : ''}</span>` : ''}</div>`;
    const wc = $('wage-check');
    if (hr) {
      const ok = hr + 0.005 >= MIN[c];
      wc.hidden = false; wc.className = 'callout ' + (ok ? 'ok' : 'warn');
      wc.textContent = ok ? `✓ ${cur}${hr.toFixed(2)} an hour, meets the minimum wage.` : `${cur}${hr.toFixed(2)} an hour is below the ${cur}${MIN[c].toFixed(2)} minimum wage, so this listing can't be accepted.`;
    } else wc.hidden = true;
    $('desc-count').textContent = (d.description || '').length;
  }

  function sync() {
    const d = val(), c = d.country;
    $('cur').textContent = CUR[c];
    $('mw-text').textContent = `${CUR[c]}${MIN[c].toFixed(2)} an hour (${MW[c]})`;
    $('postcode').placeholder = c === 'gb' ? 'e.g. GU11 1AA' : 'e.g. 2135';
    $('town').placeholder = c === 'gb' ? 'e.g. Aldershot' : 'e.g. Strathfield';
    const [lbl, ph, type] = APPLY[d.apply_method];
    $('apply-label').textContent = lbl; $('apply_value').placeholder = ph; $('apply_value').type = type === 'url' ? 'url' : type === 'tel' ? 'tel' : 'email';
    preview(d); show(check(d), false);
  }

  f.addEventListener('input', sync);
  f.addEventListener('change', sync);
  f.addEventListener('focusout', e => { const fl = e.target.closest('.fld[data-f]'); if (fl) { touched.add(fl.dataset.f); show(check(val()), false); } });

  window.addEventListener('load', () => {
    if (window.turnstile) widget = turnstile.render('#turnstile', {sitekey: SITEKEY, theme: 'auto',
      callback: t => { token = t; }, 'expired-callback': () => { token = ''; }, 'error-callback': () => { token = ''; }});
  });

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = val(), errs = check(d);
    show(errs, true);
    const fe = $('form-error'); fe.hidden = true;
    if (Object.keys(errs).length) { const first = document.querySelector('.fld.invalid input, .fld.invalid select, .fld.invalid textarea'); if (first) first.focus(); return; }
    if (!token) { fe.hidden = false; fe.textContent = 'Please complete the "I am human" check.'; return; }
    const btn = $('submit'); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const r = await fetch('/api/jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...d, turnstile_token: token})});
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        $('ref').textContent = j.id; $('main').hidden = true; $('done').hidden = false; window.scrollTo({top: 0, behavior: 'smooth'});
        return;
      }
      if (j.errors) { Object.keys(j.errors).forEach(k => touched.add(k)); show(j.errors, true); }
      fe.hidden = false; fe.textContent = j.message || 'Something went wrong. Please try again.';
    } catch { fe.hidden = false; fe.textContent = 'Network error. Please try again.'; }
    if (window.turnstile && widget !== undefined) { turnstile.reset(widget); token = ''; }
    btn.disabled = false; btn.textContent = 'Submit for review';
  });
  sync();
})();
