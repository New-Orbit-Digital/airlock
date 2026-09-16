// In-memory stand-in for the supabase-js UMD build, used only by smoke-test.js (the build sandbox
// has no egress to supabase.co). Implements the exact subset store.js calls: auth (email OTP,
// OAuth stub, session persistence, state change), from().select/upsert/insert/delete with
// .eq/.order/.contains scoped to the signed-in user (emulating RLS), rpc('delete_my_account'),
// and channel().on().subscribe() with a `__emit` hook so the test can simulate another device.
(function () {
  const rows = new Map();          // id -> row
  const users = new Map();         // email -> user id
  const pendingCodes = new Map();  // email -> code
  const CODE = '123456';
  let session = (() => { try { return JSON.parse(localStorage.getItem('fake-sb-session')); } catch { return null; } })();
  const saveSession = () => { try { session ? localStorage.setItem('fake-sb-session', JSON.stringify(session)) : localStorage.removeItem('fake-sb-session'); } catch {} };
  const authListeners = [];
  const channels = [];
  const uid = () => 'user-' + Math.random().toString(36).slice(2, 8);
  const me = () => (session ? session.user.id : null);

  function query(table) {
    const q = { _filters: [], _op: 'select' };
    q.select = () => { q._op = 'select'; return q; };
    q.upsert = (row) => { q._op = 'upsert'; q._row = row; return q; };
    q.insert = (row) => { q._op = 'insert'; q._row = row; return q; };
    q.delete = () => { q._op = 'delete'; return q; };
    q.eq = (k, v) => { q._filters.push((r) => r[k] === v); return q; };
    q.contains = (k, arr) => { q._filters.push((r) => arr.every((x) => (r[k] || []).includes(x))); return q; };
    q.order = () => q;
    q.then = (res, rej) => {
      const out = (() => {
        if (!me()) return { data: null, error: { message: 'not signed in' } };
        // RLS emulation: only the caller's rows are visible/affected
        const mine = [...rows.values()].filter((r) => r.user_id === me());
        const match = mine.filter((r) => q._filters.every((f) => f(r)));
        if (q._op === 'select') return { data: match.map((r) => ({ ...r })), error: null };
        if (q._op === 'upsert' || q._op === 'insert') {
          const row = { ...q._row, user_id: me() };
          if (!row.id) row.id = crypto.randomUUID();
          const existed = rows.has(row.id);
          rows.set(row.id, row);
          channels.forEach((c) => c.__emit({ eventType: existed ? 'UPDATE' : 'INSERT', new: { ...row }, old: {} }));
          return { data: [row], error: null };
        }
        for (const r of match) { rows.delete(r.id); channels.forEach((c) => c.__emit({ eventType: 'DELETE', new: {}, old: { id: r.id } })); }
        return { data: null, error: null };
      })();
      return Promise.resolve(out).then(res, rej);
    };
    return q;
  }

  const setSession = (email) => {
    if (!users.has(email)) users.set(email, uid());
    session = { user: { id: users.get(email), email }, access_token: 'a', refresh_token: 'r' };
    saveSession();
    authListeners.forEach((fn) => fn('SIGNED_IN', session));
  };

  function createClient() {
    return {
      auth: {
        getSession: async () => ({ data: { session } }),
        setSession: async () => ({ data: { session } }),
        onAuthStateChange: (fn) => { authListeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOAuth: async () => ({ data: { url: 'https://accounts.google.com/fake' }, error: null }),
        exchangeCodeForSession: async (code) => { if (code !== 'goodcode') return { data: {}, error: { message: 'invalid code' } }; setSession('google-user@example.com'); return { data: { session }, error: null }; },
        signInWithOtp: async ({ email }) => { pendingCodes.set(email, CODE); return { data: {}, error: null }; },
        verifyOtp: async ({ email, token }) => {
          if (pendingCodes.get(email) !== token) return { data: {}, error: { message: 'Token has expired or is invalid' } };
          pendingCodes.delete(email); setSession(email);
          return { data: { session }, error: null };
        },
        signOut: async () => { session = null; saveSession(); authListeners.forEach((fn) => fn('SIGNED_OUT', null)); return { error: null }; },
      },
      from: (table) => query(table),
      rpc: async (name) => {
        if (name !== 'delete_my_account') return { data: null, error: { message: 'unknown rpc' } };
        if (!me()) return { data: null, error: { message: 'not signed in' } };
        for (const [id, r] of rows) if (r.user_id === me()) rows.delete(id);
        const email = session.user.email;
        users.delete(email);
        return { data: 'account_deleted', error: null };
      },
      channel: () => {
        const ch = { _handlers: [] };
        ch.on = (_type, _filter, fn) => { ch._handlers.push(fn); return ch; };
        ch.subscribe = (cb) => { channels.push(ch); setTimeout(() => cb && cb('SUBSCRIBED'), 50); return ch; };
        ch.__emit = (payload) => ch._handlers.forEach((fn) => fn(payload));
        return ch;
      },
      removeChannel: (ch) => { const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); },
    };
  }
  window.supabase = { createClient };
  window.__fakeSupabase = { rows, users, CODE, get session() { return session; } };
})();
