// UI layer. All data goes through window.matrixStore (store.js); this file never touches storage.
const store = window.matrixStore;
const desk = window.desktop || null;   // present only inside the Electron app (preload.js)

let activeTag = null;      // null = all realms
let showDone = false;
let editingId = null;

const $ = (sel) => document.querySelector(sel);
const el = {
  text: $('#text'), tImportant: $('#tImportant'), tUrgent: $('#tUrgent'), add: $('#add'),
  chips: $('#chips'), showDone: $('#showDone'), mute: $('#mute'), sync: $('#sync'),
  dlg: $('#dlg'), dTitle: $('#dTitle'), dTags: $('#dTags'), dImportant: $('#dImportant'),
  dUrgent: $('#dUrgent'), dNotes: $('#dNotes'), dMeta: $('#dMeta'), dDelete: $('#dDelete'), dDone: $('#dDone'),
  login: $('#login'), lForm: $('#loginForm'), lError: $('#lError'), googleBtn: $('#googleBtn'), orRow: $('#orRow'),
  emailStep: $('#emailStep'), codeStep: $('#codeStep'), lEmail: $('#lEmail'), lCode: $('#lCode'), codeSub: $('#codeSub'),
  lSubmit: $('#lSubmit'), lBack: $('#lBack'),
  menu: $('#menu'), menuBtn: $('#menuBtn'), who: $('#who'), signOut: $('#signOut'), exportBtn: $('#exportBtn'), deleteBtn: $('#deleteBtn'),
  startup: $('#startup'), startupRow: $('#startupRow'), version: $('#version'), hint: $('#hint'),
  installBar: $('#installBar'), installMsg: $('#installMsg'), installGo: $('#installGo'), installLater: $('#installLater'), installMenu: $('#installMenu'),
  themeDark: $('#themeDark'), themeLight: $('#themeLight'), updateBar: $('#updateBar'), updateMsg: $('#updateMsg'), updateGo: $('#updateGo'), updateLater: $('#updateLater'),
  updateCheck: $('#updateCheck'), updateStatus: $('#updateStatus'),
  frameClassic: $('#frameClassic'), frameBlocking: $('#frameBlocking'),
};

// ---------- helpers ----------
const tasks = () => store.tasks;
const pressed = (btn) => btn.getAttribute('aria-pressed') === 'true';
const setPressed = (btn, v) => btn.setAttribute('aria-pressed', v ? 'true' : 'false');
const flip = (btn) => setPressed(btn, !pressed(btn));

// "Send Q3 invoices #work #taxes" -> { title: "Send Q3 invoices", tags: ["work","taxes"] }
function parseCapture(raw) {
  const tags = [];
  const title = raw.replace(/(^|\s)#([\w-]+)/g, (_m, _sp, t) => {
    const tag = t.toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  return { title, tags };
}

const QUADS = {
  q1: { important: true, urgent: true },
  q2: { important: true, urgent: false },
  q3: { important: false, urgent: true },
  q4: { important: false, urgent: false },
};
function quadrantOf(t) {
  if (t.urgent && t.important) return 'q1';
  if (!t.urgent && t.important) return 'q2';
  if (t.urgent && !t.important) return 'q3';
  return 'q4';
}
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- hashtag suggestions ----------
// "Active" tags = tags on at least one non-done card (optionally excluding one task id).
function activeTagCounts(excludeId = null) {
  const counts = {};
  for (const t of tasks()) {
    if (t.done || t.id === excludeId) continue;
    for (const tag of t.tags) counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function attachTagSuggest(input, getCounts) {
  const box = document.createElement('div');
  box.className = 'suggest';
  document.body.appendChild(box);
  let items = [], idx = 0, frag = null;

  const close = () => { box.classList.remove('open'); box.innerHTML = ''; items = []; frag = null; };
  const currentFragment = () => {
    const pos = input.selectionStart;
    const m = input.value.slice(0, pos).match(/(^|\s)#([\w-]*)$/);
    return m ? { start: pos - m[2].length - 1, end: pos, text: m[2].toLowerCase() } : null;
  };
  const position = () => {
    const r = input.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.bottom + 4 + 'px';
    box.style.minWidth = Math.min(r.width, 320) + 'px';
  };
  const draw = () => {
    box.innerHTML = '';
    if (!items.length) {
      const n = document.createElement('div'); n.className = 'none';
      n.textContent = frag.text ? `New realm #${frag.text}` : 'No active realms yet';
      box.appendChild(n);
    }
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'item' + (i === idx ? ' active' : '');
      d.innerHTML = `<span>#${it.tag}</span><span class="count">${it.count}</span>`;
      d.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      box.appendChild(d);
    });
    position(); box.classList.add('open');
  };
  const update = () => {
    frag = currentFragment();
    if (!frag) { close(); return; }
    const already = parseCapture(input.value).tags;
    const counts = getCounts();
    items = Object.keys(counts)
      .filter((tag) => tag.startsWith(frag.text) && (tag === frag.text || !already.includes(tag)))
      .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .map((tag) => ({ tag, count: counts[tag] }));
    idx = 0; draw();
  };
  const pick = (i) => {
    if (!frag || !items[i]) { close(); return; }
    const v = input.value, insert = '#' + items[i].tag + ' ';
    input.value = v.slice(0, frag.start) + insert + v.slice(frag.end).replace(/^\s+/, '');
    const caret = frag.start + insert.length;
    input.setSelectionRange(caret, caret);
    close(); input.dispatchEvent(new Event('input'));
  };
  input.addEventListener('input', update);
  input.addEventListener('click', update);
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % Math.max(items.length, 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % Math.max(items.length, 1); draw(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && items.length) { e.preventDefault(); e.stopImmediatePropagation(); pick(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  window.addEventListener('resize', () => { if (box.classList.contains('open')) position(); });
}
attachTagSuggest(el.text, () => activeTagCounts());
attachTagSuggest(el.dTags, () => activeTagCounts(editingId));
attachTagSuggest(el.dTitle, () => activeTagCounts(editingId));

// ---------- capture ----------
function addFromCapture() {
  const { title, tags } = parseCapture(el.text.value);
  if (!title) { el.text.focus(); return; }
  store.create({ title, tags, important: pressed(el.tImportant), urgent: pressed(el.tUrgent) });
  ping();
  el.text.value = '';
  setPressed(el.tImportant, false); setPressed(el.tUrgent, false);
  el.text.focus();
}
el.add.addEventListener('click', addFromCapture);
el.text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromCapture(); } });
el.tImportant.addEventListener('click', () => { flip(el.tImportant); el.text.focus(); });
el.tUrgent.addEventListener('click', () => { flip(el.tUrgent); el.text.focus(); });
document.addEventListener('keydown', (e) => {
  if (el.dlg.open || !el.login.hidden) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); flip(el.tImportant); }
  if (e.ctrlKey && e.key.toLowerCase() === 'u') { e.preventDefault(); flip(el.tUrgent); }
  if (e.key === '/' && document.activeElement !== el.text) { e.preventDefault(); el.text.focus(); }
});

// ---------- sound ----------
// One short ping when a task is added or marked done. Both happen on a click/Enter, so autoplay rules allow it.
let muted = false;
const pingAudio = (() => { try { const a = new Audio('airlock-ping.wav'); a.preload = 'auto'; a.volume = 0.6; return a; } catch { return null; } })();
function ping() {
  if (muted || !pingAudio) return;
  try { pingAudio.currentTime = 0; const p = pingAudio.play(); if (p && p.catch) p.catch(() => {}); } catch {}
}
function setMuted(on) {
  muted = !!on; el.mute.checked = muted;
  try { localStorage.setItem('airlock.mute', muted ? '1' : '0'); } catch {}
}
el.mute.addEventListener('change', () => setMuted(el.mute.checked));
(() => { let m = false; try { m = localStorage.getItem('airlock.mute') === '1'; } catch {} setMuted(m); })();

// ---------- filters ----------
el.showDone.addEventListener('change', () => { showDone = el.showDone.checked; render(); });

function renderChips() {
  const counts = {};
  for (const t of tasks()) {
    if (t.done && !showDone) continue;
    for (const tag of t.tags) counts[tag] = (counts[tag] || 0) + 1;
  }
  const tags = Object.keys(counts).sort();
  if (activeTag && !tags.includes(activeTag)) activeTag = null;
  el.chips.innerHTML = '';
  const mk = (label, tag, n) => {
    const b = document.createElement('button');
    b.className = 'chip'; setPressed(b, activeTag === tag);
    b.innerHTML = `${label}<span class="count">${n}</span>`;
    b.addEventListener('click', () => { activeTag = tag; render(); });
    el.chips.appendChild(b);
  };
  mk('All', null, tasks().filter((t) => showDone || !t.done).length);
  for (const tag of tags) mk('#' + tag, tag, counts[tag]);
}

// ---------- matrix ----------
function render() {
  renderChips();
  const buckets = { q1: [], q2: [], q3: [], q4: [] };
  for (const t of tasks()) {
    if (t.done && !showDone) continue;
    if (activeTag && !t.tags.includes(activeTag)) continue;
    buckets[quadrantOf(t)].push(t);
  }
  for (const q of Object.keys(buckets)) {
    const sec = document.getElementById(q);
    const list = sec.querySelector('.list');
    const items = buckets[q].slice().sort((a, b) => (a.done - b.done) || b.createdAt.localeCompare(a.createdAt));
    sec.querySelector('.n').textContent = items.filter((t) => !t.done).length || '';
    list.innerHTML = '';
    if (!items.length) {
      const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nothing here'; list.appendChild(e);
      continue;
    }
    for (const t of items) list.appendChild(taskCard(t));
  }
  el.hint.hidden = tasks().length > 0 || !store.user;
}

function taskCard(t) {
  const card = document.createElement('div');
  card.className = 'task' + (t.done ? ' done' : '');
  card.draggable = true;
  card.dataset.id = t.id;
  const cb = document.createElement('button');
  cb.type = 'button'; cb.className = 'tick'; cb.title = t.done ? 'Reopen' : 'Mark done'; cb.setAttribute('aria-label', cb.title);
  cb.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6.5 L4.5 9.5 L10.5 2.5"/></svg>';
  cb.addEventListener('click', (e) => {
    e.stopPropagation();
    if (t.done || card.classList.contains('leaving')) { toggleDone(t); return; }
    // draw the check, let it sit for a beat, then the card fades and the task is marked done
    cb.classList.add('on'); card.classList.add('leaving'); ping();
    setTimeout(() => { if (document.body.contains(card)) toggleDone(t); }, 1600);
  });
  const body = document.createElement('div'); body.className = 'body';
  const title = document.createElement('div'); title.className = 'title'; title.textContent = t.title;
  body.appendChild(title);
  if (t.tags.length) {
    const tags = document.createElement('div'); tags.className = 'tags';
    for (const tag of t.tags) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = '#' + tag; tags.appendChild(s); }
    body.appendChild(tags);
  }
  card.appendChild(cb); card.appendChild(body);
  if (t.notes && t.notes.trim()) { const d = document.createElement('div'); d.className = 'note-dot'; d.title = 'Has notes'; card.appendChild(d); }
  card.addEventListener('click', () => openDialog(t.id));
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', t.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

function toggleDone(t) {
  store.update(t.id, { done: !t.done, doneAt: !t.done ? new Date().toISOString() : null });
}

// ---------- quadrant names (double-click to rename; synced per user) ----------
const QUAD_DEFAULTS = { q1: 'Do', q2: 'Schedule', q3: 'Delegate', q4: 'Eliminate' };
const QUAD_IDEAS = {
  q1: ['Do', 'Act', 'Now', 'Today', 'Execute', 'Handle', 'Tackle', 'Ship', 'Launch', 'Fire', 'Mission critical', 'Front burner'],
  q2: ['Schedule', 'Plan', 'Chart', 'Book it', 'Invest', 'Build', 'Grow', 'Next up', 'This week', 'Chart the course', 'Deep work', 'Focus'],
  q3: ['Delegate', 'Automate', 'Hand off', 'Outsource', 'Assign', 'Ask', 'Offload', 'Systemize', 'Ground control', 'Quick hits', 'Batch', 'Interrupts'],
  q4: ['Eliminate', 'Reconsider', 'Jettison', 'Drop', 'Park', 'Later', 'Maybe', 'Someday', 'Let go', 'Archive', 'Backlog', 'Icebox'],
};
const quadName = (q) => store.quadNames[q] || QUAD_DEFAULTS[q];
function renderQuadNames() {
  for (const q of Object.keys(QUAD_DEFAULTS)) {
    const n = document.querySelector(`#${q} h2 .name`);
    if (!n.classList.contains('editing')) n.textContent = quadName(q);
  }
}
function editQuadName(q) {
  const n = document.querySelector(`#${q} h2 .name`);
  if (n.classList.contains('editing')) return;
  const before = quadName(q);
  n.classList.add('editing');
  n.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = 24; input.value = before; input.setAttribute('aria-label', 'Quadrant name');
  input.autocomplete = 'off'; input.spellcheck = false;
  const dice = document.createElement('button');
  dice.type = 'button'; dice.className = 'dice'; dice.title = 'Suggest a name'; dice.setAttribute('aria-label', 'Suggest a name');
  dice.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>';
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    const v = input.value.trim().slice(0, 24);
    n.classList.remove('editing'); n.innerHTML = '';
    if (commit && v !== before) store.setQuadName(q, v === QUAD_DEFAULTS[q] ? '' : v);
    renderQuadNames();
  };
  // the dice must not blur the input (blur = commit), so act on pointerdown and swallow it
  dice.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  dice.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const pool = QUAD_IDEAS[q].filter((x) => x.toLowerCase() !== input.value.trim().toLowerCase());
    input.value = pool[Math.floor(Math.random() * pool.length)];
    input.focus(); input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => setTimeout(() => finish(true), 0));
  input.addEventListener('click', (e) => e.stopPropagation());
  n.appendChild(input); n.appendChild(dice);
  input.focus(); input.select();
}
for (const q of Object.keys(QUAD_DEFAULTS)) {
  const n = document.querySelector(`#${q} h2 .name`);
  n.addEventListener('dblclick', (e) => { e.preventDefault(); editQuadName(q); });
  // phones: a double-tap fires dblclick in modern browsers, but be safe and detect it ourselves too
  let lastTap = 0;
  n.addEventListener('touchend', (e) => { const t = Date.now(); if (t - lastTap < 350) { e.preventDefault(); editQuadName(q); } lastTap = t; }, { passive: false });
}
store.on('prefs', renderQuadNames);
renderQuadNames();

// ---------- drag & drop between quadrants ----------
for (const q of Object.keys(QUADS)) {
  const sec = document.getElementById(q);
  sec.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; sec.classList.add('drop'); });
  sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop'); });
  sec.addEventListener('drop', (e) => {
    e.preventDefault();
    sec.classList.remove('drop');
    const id = e.dataTransfer.getData('text/plain');
    const t = tasks().find((x) => x.id === id);
    if (t && quadrantOf(t) !== q) store.update(id, QUADS[q]);
  });
}

// ---------- dialog ----------
function openDialog(id) {
  const t = tasks().find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  el.dTitle.value = t.title;
  el.dTags.value = t.tags.map((x) => '#' + x).join(' ');
  setPressed(el.dImportant, t.important); setPressed(el.dUrgent, t.urgent);
  el.dNotes.value = t.notes || '';
  el.dDone.textContent = t.done ? 'Reopen' : 'Mark done';
  el.dMeta.textContent = `added ${fmtDate(t.createdAt)}` + (t.done && t.doneAt ? ` · done ${fmtDate(t.doneAt)}` : '');
  el.dlg.showModal();
  el.dNotes.focus();
}

function dialogPatch() {
  const parsedTitle = parseCapture(el.dTitle.value);      // allow #tags typed into the title too
  const parsedTags = parseCapture(el.dTags.value).tags;
  const t = tasks().find((x) => x.id === editingId);
  return {
    title: parsedTitle.title || (t ? t.title : ''),
    tags: [...new Set([...parsedTags, ...parsedTitle.tags])],
    important: pressed(el.dImportant), urgent: pressed(el.dUrgent),
    notes: el.dNotes.value,
  };
}
function changed(t, p) {
  return t.title !== p.title || t.important !== p.important || t.urgent !== p.urgent || t.notes !== p.notes
    || JSON.stringify(t.tags) !== JSON.stringify(p.tags);
}
function saveDialog(extra = {}) {
  const t = tasks().find((x) => x.id === editingId);
  if (!t) return;
  const p = dialogPatch();
  if (changed(t, p) || Object.keys(extra).length) store.update(editingId, { ...p, ...extra });
}

el.dImportant.addEventListener('click', () => flip(el.dImportant));
el.dUrgent.addEventListener('click', () => flip(el.dUrgent));
el.dlg.querySelector('form').addEventListener('submit', () => saveDialog());
el.dlg.addEventListener('cancel', () => saveDialog());          // Esc also saves
el.dDone.addEventListener('click', () => {
  const t = tasks().find((x) => x.id === editingId);
  if (!t) return;
  saveDialog({ done: !t.done, doneAt: !t.done ? new Date().toISOString() : null });
  if (!t.done) ping();
  el.dlg.close();
});
el.dDelete.addEventListener('click', () => { store.remove(editingId); el.dlg.close(); });
el.dlg.addEventListener('close', () => { editingId = null; el.text.focus(); });

// ---------- sign-in ----------
// Web: Google or a 6-digit email code. Desktop (Electron): email code only for now, because
// Google refuses to run OAuth inside an embedded window.
let pendingEmail = null;
let authBusy = false;

function showEmailStep() {
  pendingEmail = null;
  el.emailStep.hidden = false; el.codeStep.hidden = true; el.lBack.hidden = true;
  el.lSubmit.textContent = 'Send me a code'; el.lError.textContent = ''; el.lCode.value = '';
  el.lEmail.focus();
}
function showCodeStep(email) {
  pendingEmail = email;
  el.emailStep.hidden = true; el.codeStep.hidden = false; el.lBack.hidden = false;
  el.codeSub.textContent = `We emailed a sign-in code to ${email}. Enter it below.`;
  el.lSubmit.textContent = 'Sign in'; el.lError.textContent = '';
  el.lCode.value = ''; el.lCode.focus();
}
async function withAuthBusy(fn) {
  if (authBusy) return;
  authBusy = true; el.lSubmit.disabled = true; el.googleBtn.disabled = true; el.lError.textContent = '';
  try { await fn(); }
  catch (err) { el.lError.textContent = err.message || 'Something went wrong'; }
  finally { authBusy = false; el.lSubmit.disabled = false; el.googleBtn.disabled = false; }
}
el.lForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingEmail) {
    const email = el.lEmail.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { el.lError.textContent = 'Enter a valid email address.'; return; }
    withAuthBusy(async () => { await store.sendCode(email); showCodeStep(email); });
  } else {
    const code = el.lCode.value.replace(/\D/g, '');
    if (code.length < 6 || code.length > 10) { el.lError.textContent = 'Enter the code from the email (6–10 digits).'; return; }
    withAuthBusy(() => store.verifyCode(pendingEmail, code));
  }
});
el.lCode.addEventListener('input', () => { el.lCode.value = el.lCode.value.replace(/\D/g, '').slice(0, 10); });
el.lBack.addEventListener('click', showEmailStep);
el.googleBtn.addEventListener('click', () => withAuthBusy(async () => {
  if (!desk) return store.signInWithGoogle();
  const url = await store.googleUrlForDesktop();
  await desk.openExternal(url);
  el.lError.textContent = 'Finish signing in with Google in your browser, then come back here.';
}));
if (desk) {
  desk.onDeepLink((url) => {
    let code = null, err = null;
    try { const u = new URL(url); code = u.searchParams.get('code'); err = u.searchParams.get('error_description') || u.searchParams.get('error'); } catch {}
    if (err) { el.lError.textContent = err; return; }
    if (code) withAuthBusy(() => store.exchangeCode(code));
  });
}
for (const a of document.querySelectorAll('#privacyLink, #privacyLink2')) a.href = window.MATRIX_CONFIG.privacyUrl;

// ---------- theme ----------
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  setPressed(el.themeDark, mode === 'dark'); setPressed(el.themeLight, mode === 'light');
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = mode === 'light' ? '#f4f5f8' : '#111318';
  try { localStorage.setItem('airlock.theme', mode); } catch {}
}
el.themeDark.addEventListener('click', () => applyTheme('dark'));
el.themeLight.addEventListener('click', () => applyTheme('light'));
(() => { let m = 'dark'; try { m = localStorage.getItem('airlock.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch {} applyTheme(m); })();

// ---------- framing (Important/Urgent vs Blocking/Deadline) ----------
// Purely a relabeling of the same two flags and the same four quadrants — no data changes,
// so switching back and forth is free and nothing is lost. Local to this device (not synced).
const FRAMINGS = {
  classic: {
    flagImportant: 'Important', flagUrgent: 'Urgent',
    subs: { q1: 'urgent · important', q2: 'important · not urgent', q3: 'urgent · not important', q4: 'neither' },
    hint: 'Type a task above and press Enter. Add <code>#realm</code> tags to sort by area of life (<code>#work</code>, <code>#home</code>…), and flip <b>Important</b> / <b>Urgent</b> before you add — the task lands in the right quadrant automatically. Click a card for notes; drag it to move it.',
  },
  blocking: {
    flagImportant: 'Blocking', flagUrgent: 'Deadline',
    subs: { q1: 'deadline · blocking', q2: 'blocking · no deadline', q3: 'deadline · not blocking', q4: 'neither' },
    hint: 'Type a task above and press Enter. Add <code>#realm</code> tags to sort by area of life (<code>#work</code>, <code>#home</code>…), and flip <b>Blocking</b> / <b>Deadline</b> before you add — the task lands in the right quadrant automatically. Click a card for notes; drag it to move it.',
  },
};
function applyFraming(mode) {
  const key = FRAMINGS[mode] ? mode : 'classic';
  const f = FRAMINGS[key];
  el.tImportant.querySelector('.lbl').textContent = f.flagImportant;
  el.tUrgent.querySelector('.lbl').textContent = f.flagUrgent;
  el.dImportant.textContent = f.flagImportant;
  el.dUrgent.textContent = f.flagUrgent;
  for (const q of Object.keys(f.subs)) {
    const sub = document.querySelector(`#${q} h2 .sub`);
    if (sub) sub.textContent = f.subs[q];
  }
  el.hint.innerHTML = f.hint;
  setPressed(el.frameClassic, key === 'classic'); setPressed(el.frameBlocking, key === 'blocking');
  try { localStorage.setItem('airlock.framing', key); } catch {}
}
el.frameClassic.addEventListener('click', () => applyFraming('classic'));
el.frameBlocking.addEventListener('click', () => applyFraming('blocking'));
(() => { let m = 'classic'; try { m = localStorage.getItem('airlock.framing') || 'classic'; } catch {} applyFraming(m); })();

// ---------- account menu ----------
el.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); el.menu.hidden = !el.menu.hidden; });
document.addEventListener('click', (e) => { if (!el.menu.contains(e.target)) el.menu.hidden = true; });
el.signOut.addEventListener('click', () => { el.menu.hidden = true; store.signOut(); });
el.exportBtn.addEventListener('click', () => {
  el.menu.hidden = true;
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `airlock-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
el.deleteBtn.addEventListener('click', async () => {
  el.menu.hidden = true;
  const typed = prompt('This permanently deletes your account and every task in it. Type DELETE to confirm.');
  if (typed !== 'DELETE') return;
  try {
    const result = await store.deleteAccount();
    if (result === 'data_deleted_account_kept') alert('Your Airlock tasks were deleted. Your login was kept because it is shared with another app.');
  } catch (err) { alert('Could not delete account: ' + (err.message || err)); }
});

// ---------- desktop-only: launch at startup ----------
if (desk) {
  el.startupRow.hidden = false;
  desk.getStartup().then((v) => { el.startup.checked = v; });
  el.startup.addEventListener('change', () => desk.setStartup(el.startup.checked));
  desk.version().then((v) => { el.version.textContent = 'v' + v; });
}

// ---------- sync status ----------
const STATUS_LABEL = { offline: 'offline — changes queued', syncing: 'syncing…', synced: 'synced', error: 'sync error — retrying', 'signed-out': '' };
store.on('status', (s) => {
  el.sync.textContent = STATUS_LABEL[s] || s;
  el.sync.dataset.state = s;
});
store.on('change', render);
store.on('auth', (user) => {
  el.login.hidden = !!user;
  el.who.textContent = user ? (user.email || 'signed in') : '';
  if (user) el.text.focus();
  else showEmailStep();
});

// ---------- install prompts (web only) ----------
// Chrome/Edge/Android Chrome fire beforeinstallprompt; everywhere else the menu item opens the install guide.
(function installPrompts() {
  if (desk) return;                                   // the desktop app is already installed
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const KEY = 'airlock.installHint.dismissed';
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === '1'; } catch {}
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios|chrome|android/i.test(navigator.userAgent);
  let deferred = null;
  el.installMenu.hidden = false;

  const showBar = (msg, canInstall) => {
    if (dismissed || !store.user) return;
    el.installMsg.innerHTML = msg; el.installGo.hidden = !canInstall; el.installBar.hidden = false;
  };
  const dismiss = () => { dismissed = true; el.installBar.hidden = true; try { localStorage.setItem(KEY, '1'); } catch {} };
  el.installLater.addEventListener('click', dismiss);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    showBar('Install <b>Airlock</b> for a home-screen icon and full-screen capture.', true);
  });
  const doInstall = async () => {
    if (!deferred) { window.open('/download/', '_blank', 'noopener'); return; }   // no native prompt here → guide
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') dismiss(); else el.installBar.hidden = true;
  };
  el.installGo.addEventListener('click', doInstall);
  el.installMenu.addEventListener('click', () => { el.menu.hidden = true; doInstall(); });
  window.addEventListener('appinstalled', () => { dismiss(); el.installMenu.hidden = true; });

  if (isIOS) {
    const msg = isSafari
      ? 'On iPhone: tap <b>Share</b> (the box with an arrow) → <b>Add to Home Screen</b> to install Airlock.'
      : 'On iPhone, open this page in <b>Safari</b>, then Share → <b>Add to Home Screen</b> to install Airlock.';
    store.on('auth', (u) => { if (u) setTimeout(() => showBar(msg, false), 1500); });
  }
})();

// ---------- desktop auto-update ----------
if (desk) {
  el.updateCheck.hidden = false;
  const setStatus = (t) => { el.updateStatus.textContent = t; el.updateStatus.hidden = !t; };
  desk.onUpdate((info) => {
    if (info.state === 'ready') { el.updateMsg.innerHTML = `Airlock <b>${info.version}</b> is downloaded.`; el.updateBar.hidden = false; setStatus(`Version ${info.version} ready — restart to install`); }
    else if (info.state === 'downloading') setStatus(`Downloading ${info.version}…`);
    else if (info.state === 'none') setStatus('You have the latest version');
    else if (info.state === 'error') setStatus('Update check failed — will retry later');
  });
  el.updateGo.addEventListener('click', () => desk.installUpdate());
  el.updateLater.addEventListener('click', () => { el.updateBar.hidden = true; });
  el.updateCheck.addEventListener('click', async () => {
    setStatus('Checking…');
    const r = await desk.checkForUpdates();
    if (r.state === 'dev') setStatus('Updates only apply to the installed app');
    else if (r.state === 'ready') setStatus(`Version ${r.version} ready — restart to install`);
    else if (r.state === 'error') setStatus('Update check failed — will retry later');
  });
}

// ---------- boot ----------
render();
store.init();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
