// Moderation UI. Requests go to /api/admin/* which Cloudflare Access protects; the worker re-verifies the Access JWT.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const CUR = {gb: '£', au: 'A$'}, ICON = {care:'🩺',hospitality:'🍳',retail:'🛒',cleaning:'🧽',warehouse:'📦',security:'🛡️',delivery:'🚚',hotels:'🏨'};
  const STATUSES = ['pending', 'approved', 'rejected', 'expired', 'all'];
  let status = new URLSearchParams(location.search).get('status') || 'pending';
  const fmt = d => d ? new Date(d).toLocaleString('en-GB', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London'}) : '–';

  async function api(path, opts = {}) {
    const r = await fetch('/api/admin' + path, {credentials: 'same-origin', headers: {'content-type': 'application/json'}, ...opts});
    if (r.status === 401) { location.href = '/admin'; throw new Error('auth'); }
    return r.json();
  }
  function item(j) {
    const cur = CUR[j.country];
    const pay = `${cur}${j.pay_period === 'year' ? Math.round(j.pay_amount).toLocaleString('en-GB') : Number(j.pay_amount).toFixed(2)} per ${j.pay_period}` + (j.pay_period !== 'hour' ? ` (≈ ${cur}${Number(j.hourly_equiv).toFixed(2)}/hr)` : '');
    const acts = [];
    if (j.status !== 'approved') acts.push(`<button class="btn btn-primary" data-act="approve" data-id="${j.id}">✓ Approve (30 days)</button>`);
    if (j.status === 'pending' || j.status === 'approved') acts.push(`<button class="btn btn-ghost" data-act="reject" data-id="${j.id}">✕ Reject</button>`);
    if (j.status === 'approved') acts.push(`<button class="btn btn-ghost" data-act="expire" data-id="${j.id}">⌛ Expire now</button><a class="btn btn-soft" href="/jobs/p/${j.id}" target="_blank">View live page</a>`);
    acts.push(`<button class="btn btn-ghost" data-act="delete" data-id="${j.id}" style="margin-left:auto">🗑 Delete</button>`);
    return `<article class="admin-item" id="j-${j.id}">
      <div class="job-top"><div class="avatar">${ICON[j.industry] || '💼'}</div><div><h3 style="margin:0">${esc(j.title)}</h3>
      <div class="sub muted">${esc(j.employer)} · ${esc(j.town)}, ${esc(j.postcode)} · ${j.country.toUpperCase()}</div></div>
      <span class="pill ${j.status === 'approved' ? 'ok' : j.status === 'pending' ? 'warn' : ''}" style="margin-left:auto">${j.status}</span></div>
      <div class="meta">
        <div><b>Pay:</b> ${esc(pay)}</div><div><b>Hours:</b> ${esc(j.contract_type.replace('_', '-'))}, ${j.hours_per_week}/wk</div>
        <div><b>Student-friendly:</b> ${j.student_friendly ? 'Yes' : 'No'}</div><div><b>Apply:</b> ${esc(j.apply_method)}: ${esc(j.apply_value)}</div>
        <div><b>Private contact:</b> <a href="mailto:${esc(j.contact_email)}">${esc(j.contact_email)}</a></div><div><b>Ref:</b> ${j.id}</div>
        <div><b>Submitted:</b> ${fmt(j.created_at)}</div><div><b>Expires:</b> ${fmt(j.expires_at)}</div>
      </div>
      <details><summary>Description</summary><p class="prose">${esc(j.description)}</p></details>
      ${j.moderation_note ? `<p class="note">${esc(j.moderation_note)}</p>` : ''}
      <div class="admin-actions">${acts.join('')}</div></article>`;
  }
  async function load() {
    const d = await api(`/jobs?status=${status}`);
    document.getElementById('tabs').innerHTML = STATUSES.map(s => `<button class="chip" aria-pressed="${s === status}" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}${s !== 'all' ? ` (${d.counts?.[s] || 0})` : ''}</button>`).join('');
    document.getElementById('items').innerHTML = d.jobs?.length ? d.jobs.map(item).join('')
      : `<div class="empty"><div class="big">📭</div><h3>Nothing ${status === 'all' ? 'here' : status}</h3><p class="muted">New employer posts will appear under Pending.</p></div>`;
  }
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-s]'); if (t) { status = t.dataset.s; history.replaceState(null, '', '?status=' + status); return load(); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const {act, id} = b.dataset;
    if (act === 'delete' && !confirm('Delete this listing permanently?')) return;
    let body;
    if (act === 'reject') { const note = prompt('Reason for rejecting (optional, private):', ''); if (note === null) return; body = JSON.stringify({note}); }
    b.disabled = true;
    const r = act === 'delete' ? await api(`/jobs/${id}`, {method: 'DELETE'}) : await api(`/jobs/${id}/${act}`, {method: 'POST', body: body || '{}'});
    if (!r.ok) alert(r.message || 'Action failed');
    load();
  });
  load();
})();
