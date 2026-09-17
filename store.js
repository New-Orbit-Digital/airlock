// Sync store: Supabase is the source of truth, localStorage is the cache so the UI is
// instant and survives offline. Writes apply locally first, then push; failed pushes
// queue and retry when we're back online. Realtime keeps other devices in step.
(function () {
  const cfg = window.MATRIX_CONFIG;
  const CACHE_KEY = 'matrix.tasks.v1';
  const QUEUE_KEY = 'matrix.queue.v1';

  // detectSessionInUrl handles the ?code= that Google OAuth returns with (PKCE flow).
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });

  let tasks = [];
  let queue = [];          // [{ op: 'upsert'|'delete', id, row? }]
  let user = null;
  let channel = null;
  let status = 'offline';  // 'offline' | 'syncing' | 'synced' | 'error' | 'signed-out'
  const listeners = { change: [], status: [], auth: [], prefs: [] };

  const emit = (ev, arg) => listeners[ev].forEach((fn) => fn(arg));
  const setStatus = (s) => { status = s; emit('status', s); };
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ---- row <-> task (camelCase in the app, snake_case in the DB) ----
  const toRow = (t) => ({
    id: t.id, title: t.title, tags: t.tags, important: t.important, urgent: t.urgent,
    notes: t.notes || '', done: t.done, created_at: t.createdAt, done_at: t.doneAt, updated_at: t.updatedAt,
  });
  const fromRow = (r) => ({
    id: r.id, title: r.title, tags: r.tags || [], important: r.important, urgent: r.urgent,
    notes: r.notes || '', done: r.done, createdAt: r.created_at, doneAt: r.done_at, updatedAt: r.updated_at,
  });

  function friendlyAuthError(err) {
    const m = (err && err.message) || '';
    if (/rate limit/i.test(m)) return 'Too many attempts — wait a minute and try again.';
    if (/expired|invalid/i.test(m)) return 'That code is wrong or has expired.';
    if (/signups not allowed/i.test(m)) return 'Sign-ups are closed right now.';
    return m || 'Sign-in failed';
  }

  const persistLocal = () => { writeJSON(CACHE_KEY, tasks); writeJSON(QUEUE_KEY, queue); };

  // ---- per-user settings (quadrant names) — tiny row in matrix_settings, cached locally ----
  const QUADS_KEY = 'airlock.quads.v1';
  let quadNames = readJSON(QUADS_KEY, {});
  let quadNamesUpdatedAt = null;
  let settingsTimer = null;
  const applySettingsRow = (r) => {
    if (!r) return;
    if (quadNamesUpdatedAt && r.updated_at < quadNamesUpdatedAt) return;   // last write wins
    quadNames = (r.quad_names && typeof r.quad_names === 'object') ? r.quad_names : {};
    quadNamesUpdatedAt = r.updated_at;
    writeJSON(QUADS_KEY, quadNames);
    emit('prefs', quadNames);
  };
  async function pullSettings() {
    const { data, error } = await sb.from('matrix_settings').select('*').eq('user_id', user.id);
    if (error) { console.warn('settings pull failed', error.message); return; }
    if (data && data[0]) applySettingsRow(data[0]);
  }
  async function pushSettings() {
    if (!user) return;
    const row = { user_id: user.id, quad_names: quadNames, updated_at: quadNamesUpdatedAt };
    const { error } = await sb.from('matrix_settings').upsert(row, { onConflict: 'user_id' });
    if (error) { console.warn('settings push failed, will retry', error.message); clearTimeout(settingsTimer); settingsTimer = setTimeout(pushSettings, 15000); }
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

  // ---- queue processing ----
  let flushing = false;
  async function flush() {
    if (!user || flushing || !queue.length) { if (user && !queue.length && status !== 'error') setStatus('synced'); return; }
    flushing = true;
    setStatus('syncing');
    try {
      while (queue.length) {
        const item = queue[0];
        if (item.op === 'upsert') {
          const { error } = await sb.from(cfg.table).upsert(item.row, { onConflict: 'id' });
          if (error) throw error;
        } else {
          const { error } = await sb.from(cfg.table).delete().eq('id', item.id);
          if (error) throw error;
        }
        queue.shift();
        persistLocal();
      }
      setStatus('synced');
    } catch (e) {
      console.warn('sync push failed, will retry', e.message || e);
      setStatus(navigator.onLine ? 'error' : 'offline');
      setTimeout(flush, 15000);
    } finally {
      flushing = false;
    }
  }

  function enqueue(item) {
    // collapse redundant queued ops for the same id
    queue = queue.filter((q) => q.id !== item.id);
    queue.push(item);
    persistLocal();
    flush();
  }

  // ---- full pull + realtime ----
  async function pull() {
    setStatus('syncing');
    const { data, error } = await sb.from(cfg.table).select('*').order('created_at', { ascending: false });
    if (error) { console.warn('pull failed', error.message); setStatus('error'); return; }
    const remote = data.map(fromRow);
    // keep any local rows that are still queued (not yet pushed)
    const pendingIds = new Set(queue.map((q) => q.id));
    const localPending = tasks.filter((t) => pendingIds.has(t.id));
    const merged = new Map(remote.map((t) => [t.id, t]));
    for (const t of localPending) merged.set(t.id, t);
    for (const q of queue) if (q.op === 'delete') merged.delete(q.id);
    tasks = [...merged.values()];
    persistLocal();
    emit('change', tasks);
    await flush();
  }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('matrix_tasks_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matrix_settings' }, (payload) => {
        if (payload.eventType !== 'DELETE') applySettingsRow(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: cfg.table }, (payload) => {
        if (payload.eventType === 'DELETE') {
          tasks = tasks.filter((t) => t.id !== payload.old.id);
        } else {
          const incoming = fromRow(payload.new);
          const i = tasks.findIndex((t) => t.id === incoming.id);
          if (i === -1) tasks.unshift(incoming);
          else if (!tasks[i].updatedAt || incoming.updatedAt >= tasks[i].updatedAt) tasks[i] = incoming;
        }
        persistLocal();
        emit('change', tasks);
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') { pull(); pullSettings(); }   // re-pull on (re)connect so nothing missed offline is lost
      });
  }

  // ---- public API ----
  const api = {
    on(ev, fn) { listeners[ev].push(fn); return api; },
    get tasks() { return tasks; },
    get status() { return status; },
    get user() { return user; },
    get quadNames() { return quadNames; },
    setQuadName(q, name) {
      const next = { ...quadNames };
      if (name) next[q] = name; else delete next[q];
      quadNames = next; quadNamesUpdatedAt = new Date().toISOString();
      writeJSON(QUADS_KEY, quadNames);
      emit('prefs', quadNames);
      pushSettings();
    },

    async init() {
      tasks = readJSON(CACHE_KEY, []);
      queue = readJSON(QUEUE_KEY, []);
      emit('change', tasks);
      const { data: { session } } = await sb.auth.getSession();
      // after an OAuth round-trip, drop ?code=… / #… so a refresh doesn't retry the exchange
      if (location.protocol.startsWith('http') && (location.search || location.hash)) {
        history.replaceState(null, '', location.origin + location.pathname);
      }
      await handleSession(session);
      sb.auth.onAuthStateChange((_evt, s) => {
        if ((s && s.user && s.user.id) !== (user && user.id)) handleSession(s);
      });
      window.addEventListener('online', () => { if (user) pull(); });
      window.addEventListener('offline', () => setStatus('offline'));
    },

    // ---- auth ----
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
    },
    // Desktop: get the Google URL without navigating; the shell opens it in the system browser and the
    // airlock://auth?code=... return is exchanged here (the PKCE verifier lives in this client's storage).
    async googleUrlForDesktop() {
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'airlock://auth', skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
      return data.url;
    },
    async exchangeCode(code) {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) throw new Error(friendlyAuthError(error));
    },
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new Error(friendlyAuthError(error));
    },
    async verifyCode(email, token) {
      const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw new Error(friendlyAuthError(error));
    },
    async signOut() {
      await sb.auth.signOut();
      tasks = []; queue = []; persistLocal(); emit('change', tasks);
      quadNames = {}; quadNamesUpdatedAt = null; writeJSON(QUADS_KEY, quadNames); emit('prefs', quadNames);
    },
    exportJSON() {
      return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Airlock', tasks }, null, 2);
    },
    async deleteAccount() {
      const { data, error } = await sb.rpc('delete_my_account');
      if (error) throw error;
      tasks = []; queue = []; persistLocal(); emit('change', tasks);
      quadNames = {}; quadNamesUpdatedAt = null; writeJSON(QUADS_KEY, quadNames); emit('prefs', quadNames);
      await sb.auth.signOut();
      return data;
    },

    create(fields) {
      const now = new Date().toISOString();
      const t = { id: uuid(), title: fields.title, tags: fields.tags || [], important: !!fields.important,
        urgent: !!fields.urgent, notes: '', done: false, createdAt: now, doneAt: null, updatedAt: now };
      tasks.unshift(t);
      emit('change', tasks);
      enqueue({ op: 'upsert', id: t.id, row: toRow(t) });
      return t;
    },
    update(id, patch) {
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      Object.assign(t, patch, { updatedAt: new Date().toISOString() });
      emit('change', tasks);
      enqueue({ op: 'upsert', id: t.id, row: toRow(t) });
      return t;
    },
    remove(id) {
      tasks = tasks.filter((x) => x.id !== id);
      emit('change', tasks);
      enqueue({ op: 'delete', id });
    },

  };

  async function handleSession(session) {
    user = session ? session.user : null;
    emit('auth', user);
    if (!user) {
      if (channel) { sb.removeChannel(channel); channel = null; }
      setStatus('signed-out');
      return;
    }
    subscribe();
  }

  window.matrixStore = api;
})();
