/**
 * fakesupabase.js — an in-memory Supabase client for testing app.html.
 *
 * WHY THIS EXISTS
 * 40 of the 181 functions inside initApp talk to Supabase (49% of initApp's
 * bytes). They are the largest unreachable block, and therefore the last thing
 * standing between this suite and a real refactor of initApp. Until network
 * functions can run, "I moved code" and "I broke code" still look identical for
 * half the app.
 *
 * THIS IS NOT A MOCK THAT RETURNS CANNED DATA. It is a tiny in-memory database:
 * insert/update/upsert/delete really mutate, and select really filters and sorts.
 * That matters because the bugs worth catching are the ones where the app reads
 * back what it just wrote and gets a surprise (a blocked write that reports
 * success, a delete that removes nothing, an update that matches no row).
 *
 * SURFACE — derived by measurement from app.html, not guessed:
 *   .from() 14 tables: profiles shifts interviews maintenance_requests purchases
 *     push_subscriptions role_levels shift_audit maintenance-photos access_codes
 *     schedules bitacora descanso_requests onboarding
 *   verbs, by real usage: eq(43) select(38) maybeSingle(16) order(16) update(15)
 *     contains(8) delete(7) upsert(6) insert(5) single(3) gte(2) lte(2) limit(2) in(1)
 *   .storage.from(b).list()/upload()/getPublicUrl()
 *   .auth.getUser/getSession/signInWithOtp/signOut/verifyOtp/onAuthStateChange
 *   .channel().on('postgres_changes'|'presence').subscribe()
 *
 * SAFETY: like the sandbox, this module makes NO network calls. It is pure
 * JavaScript over plain arrays. tests/safety.test.js audits it as such.
 */

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/** Coerce for comparison the way SQL loosely would (null-safe, date-aware). */
function loose(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const da = new Date(a), db = new Date(b);
  if (!isNaN(da) && !isNaN(db) && typeof a !== 'number' && typeof b !== 'number') {
    return da.getTime() === db.getTime();
  }
  return String(a) === String(b);
}

function getPath(row, path) {
  // Supports `a.b.c` paths, as supabase supports for JSON columns.
  if (path.indexOf('.') === -1) return row == null ? undefined : row[path];
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), row);
}

function sortRows(rows, orders) {
  if (!orders.length) return rows;
  return rows.slice().sort((a, b) => {
    for (const o of orders) {
      const av = getPath(a, o.column);
      const bv = getPath(b, o.column);
      const an = av == null, bn = bv == null;
      if (an && bn) continue;
      if (an) return 1;   // nulls last, as postgres default for ASC
      if (bn) return -1;
      let cmp;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return o.ascending ? cmp : -cmp;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

class FakeDB {
  constructor(seed) {
    this.tables = new Map();
    this.log = [];            // every operation, for assertions
    this.failures = new Map(); // table -> error to return on next write
    this.sequence = 0;
    for (const [name, rows] of Object.entries(seed || {})) {
      this.tables.set(name, rows.map((r) => this._prepareRow(r)));
    }
  }

  _prepareRow(row) {
    const out = Object.assign({}, row);
    if (out.id === undefined) out.id = 'row-' + (++this.sequence);
    if (out.created_at === undefined) out.created_at = new Date().toISOString();
    return out;
  }

  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table);
  }

  /** Seed or replace a table wholesale (test setup). */
  seed(table, rows) {
    this.tables.set(table, (rows || []).map((r) => this._prepareRow(r)));
    return this;
  }

  /** Make the NEXT write to `table` fail the way a real RLS denial does. */
  failNextWrite(table, message, code) {
    this.failures.set(table, { message: message || 'new row violates row-level security policy', code: code || '42501' });
    return this;
  }

  /** Force the next write to a table to affect ZERO rows but report success —
   *  the exact behaviour of an RLS-filtered UPDATE, which does NOT raise. */
  silentZeroRows(table) {
    this.failures.set(table, { silent: true });
    return this;
  }
}

// ---------------------------------------------------------------------------
// Query builder — thenable, and it really executes against the store
// ---------------------------------------------------------------------------

class FakeQuery {
  constructor(db, table, op) {
    this._db = db;
    this._table = table;
    this._op = op;              // 'select' | 'insert' | 'update' | 'upsert' | 'delete'
    this._filters = [];
    this._orders = [];
    this._limit = null;
    this._range = null;
    this._payload = null;
    this._selectCols = null;
    this._single = null;        // 'single' | 'maybeSingle'
    this._onConflict = null;
    this._count = null;
    this._executed = false;
    this._result = null;
  }

  // -- terminal modifiers --------------------------------------------------
  select(cols, opts) {
    if (this._op === 'select' || this._op === undefined) this._op = this._op || 'select';
    this._selectCols = cols === undefined ? '*' : cols;
    if (opts && opts.count) this._count = opts.count;
    if (opts && opts.head) this._head = true;
    // An insert/update followed by .select() returns the affected rows.
    if (this._op === 'select') this._op = 'select';
    return this;
  }
  insert(rows) { this._op = 'insert'; this._payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this._op = this._op === 'insert' ? 'insert' : 'update'; this._payload = patch; return this; }
  upsert(rows, opts) {
    this._op = 'upsert';
    this._payload = Array.isArray(rows) ? rows : [rows];
    if (opts && opts.onConflict) this._onConflict = opts.onConflict;
    return this;
  }
  delete() { this._op = 'delete'; return this; }

  // -- filters -------------------------------------------------------------
  _push(col, op, val) { this._filters.push({ col, op, val }); return this; }
  eq(col, val) { return this._push(col, 'eq', val); }
  neq(col, val) { return this._push(col, 'neq', val); }
  gt(col, val) { return this._push(col, 'gt', val); }
  gte(col, val) { return this._push(col, 'gte', val); }
  lt(col, val) { return this._push(col, 'lt', val); }
  lte(col, val) { return this._push(col, 'lte', val); }
  like(col, val) { return this._push(col, 'like', val); }
  ilike(col, val) { return this._push(col, 'ilike', val); }
  is(col, val) { return this._push(col, 'is', val); }
  in(col, vals) { return this._push(col, 'in', vals); }
  contains(col, val) { return this._push(col, 'contains', val); }
  match(obj) { Object.entries(obj).forEach(([k, v]) => this._push(k, 'eq', v)); return this; }
  filter(col, op, val) { return this._push(col, op, val); }
  not(col, op, val) { return this._push(col, 'not:' + op, val); }
  or(_) { return this; }   // accepted; no test depends on OR semantics yet
  textSearch() { return this; }

  order(col, opts) {
    this._orders.push({ column: col, ascending: !(opts && opts.ascending === false) });
    return this;
  }
  limit(n) { this._limit = n; return this; }
  range(a, b) { this._range = [a, b]; return this; }
  single() { this._single = 'single'; return this; }
  maybeSingle() { this._single = 'maybeSingle'; return this; }
  count(mode) { this._count = mode || 'exact'; return this; }
  head() { this._head = true; return this; }
  csv() { return this; }
  abortSignal() { return this; }

  _matches(row) {
    return this._filters.every(({ col, op, val }) => {
      const v = getPath(row, col);
      switch (op) {
        case 'eq': return loose(v, val);
        case 'neq': return !loose(v, val);
        case 'gt': return v != null && v > val;
        case 'gte': return v != null && v >= val;
        case 'lt': return v != null && v < val;
        case 'lte': return v != null && v <= val;
        case 'is': return val === null ? v == null : loose(v, val);
        case 'in': return (val || []).some((x) => loose(v, x));
        case 'like': case 'ilike': return likeMatch(String(v == null ? '' : v), String(val), op === 'ilike');
        case 'contains': {
          // array or object containment
          if (Array.isArray(v)) return Array.isArray(val) ? val.every((x) => v.some((y) => loose(y, x))) : v.some((y) => loose(y, val));
          if (v && typeof v === 'object') return Object.entries(val || {}).every(([k, x]) => loose(v[k], x));
          return loose(v, val);
        }
        case 'not:eq': return !loose(v, val);
        default: return true;
      }
    });
  }

  _project(rows) {
    // COLUMN PROJECTION. Supabase returns ONLY the columns asked for; a fake that
    // returns the whole row would hide a real bug class — the app reading a field it
    // never requested (which works in a test and returns undefined in production).
    // `.select('level')` must yield ONLY { level }.
    const sel = this._selectCols;
    if (!sel || sel === '*' || sel === '' || typeof sel !== 'string') return rows;
    // Nested/embedded selects contain '(' — leave those alone rather than pretend.
    if (sel.indexOf('(') !== -1) return rows;
    const cols = sel.split(',').map((c) => c.trim()).filter(Boolean);
    if (!cols.length) return rows;
    return rows.map((r) => {
      const out = {};
      for (const c of cols) {
        if (c.indexOf('.') === -1) { if (c in r) out[c] = r[c]; }
        else {
          // JSON path: keep the leaf reachable under its key
          const val = getPath(r, c);
          if (val !== undefined) out[c] = val;
        }
      }
      return out;
    });
  }

  // -- execution -----------------------------------------------------------
  _execute() {
    if (this._executed) return this._result;
    this._executed = true;
    const db = this._db;
    const table = this._table;
    const rows = db.rows(table);
    const entry = { table, op: this._op, filters: this._filters, payload: this._payload };
    db.log.push(entry);

    const forced = db.failures.get(table);
    if (forced && (this._op === 'insert' || this._op === 'update' || this._op === 'upsert' || this._op === 'delete')) {
      db.failures.delete(table);
      if (!forced.silent) {
        this._result = { data: null, error: { message: forced.message, code: forced.code, details: null, hint: null }, count: null, status: 403, statusText: 'Forbidden' };
        entry.error = forced;
        return this._result;
      }
      // silent-zero: report success, change nothing (RLS-filtered UPDATE)
      entry.silentZero = true;
      this._result = { data: this._single ? null : [], error: null, count: 0, status: 200, statusText: 'OK' };
      return this._result;
    }

    let out = [];

    if (this._op === 'insert' || this._op === 'upsert') {
      for (const p of this._payload) {
        if (this._op === 'upsert' && this._onConflict) {
          const keys = String(this._onConflict).split(',').map((k) => k.trim());
          const existing = rows.find((r) => keys.every((k) => loose(r[k], p[k])));
          if (existing) { Object.assign(existing, p); out.push(existing); continue; }
        }
        const row = db._prepareRow(p);
        rows.push(row);
        out.push(row);
      }
    } else if (this._op === 'update') {
      for (const r of rows) {
        if (this._matches(r)) { Object.assign(r, this._payload); out.push(r); }
      }
    } else if (this._op === 'delete') {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (this._matches(rows[i])) out.push(rows.splice(i, 1)[0]);
      }
    } else {
      // select
      out = rows.filter((r) => this._matches(r));
      out = sortRows(out, this._orders);
      if (this._range) out = out.slice(this._range[0], this._range[1] + 1);
      if (this._limit != null) out = out.slice(0, this._limit);
      // Projection LAST, after filtering/sorting/paging — those operate on the real
      // row, and only the returned shape is narrowed.
      out = this._project(out);
    }

    // A written row that asked for .select() returns the affected rows; otherwise
    // supabase returns null data for a plain write.
    let data;
    if (this._op === 'select') data = out;
    else if (this._selectCols) data = out;
    else if (this._single) data = out[0] || null;
    else data = null;

    if (this._head) {
      this._result = { data: null, error: null, count: out.length, status: 200, statusText: 'OK' };
      return this._result;
    }

    if (this._single === 'single') {
      if (!out.length) {
        this._result = { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: '0 rows', hint: null }, count: null, status: 406, statusText: 'Not Acceptable' };
        return this._result;
      }
      this._result = { data: out[0], error: null, count: null, status: 200, statusText: 'OK' };
      return this._result;
    }
    if (this._single === 'maybeSingle') {
      this._result = { data: out[0] || null, error: null, count: null, status: 200, statusText: 'OK' };
      return this._result;
    }

    this._result = { data, error: null, count: this._count ? out.length : null, status: 200, statusText: 'OK' };
    return this._result;
  }

  then(onFulfilled, onRejected) {
    // Thenable so `await supabase.from(..)...` works exactly as in the app.
    return Promise.resolve(this._execute()).then(onFulfilled, onRejected);
  }
  catch(fn) { return this.then(undefined, fn); }
  finally(fn) { return this.then().finally(fn); }
}

function likeMatch(value, pattern, ci) {
  const v = ci ? value.toLowerCase() : value;
  const p = ci ? pattern.toLowerCase() : pattern;
  const rx = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
  return rx.test(v);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

class FakeStorage {
  constructor() { this.buckets = new Map(); this.log = []; }
  from(bucket) {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
    const files = this.buckets.get(bucket);
    return {
      list: async (prefix) => {
        this.log.push({ bucket, op: 'list', prefix });
        const names = [...files.keys()].filter((k) => !prefix || k.startsWith(prefix));
        return { data: names.map((name) => ({ name })), error: null };
      },
      upload: async (path, file) => {
        this.log.push({ bucket, op: 'upload', path });
        files.set(path, file);
        return { data: { path, id: path }, error: null };
      },
      remove: async (paths) => {
        this.log.push({ bucket, op: 'remove', paths });
        (paths || []).forEach((p) => files.delete(p));
        return { data: paths, error: null };
      },
      getPublicUrl: (path) => {
        this.log.push({ bucket, op: 'getPublicUrl', path });
        // A URL STRING only. Nothing is fetched; the sandbox has no socket anyway.
        return { data: { publicUrl: 'https://fake.local/' + bucket + '/' + path } };
      },
      createSignedUrl: async (path) => ({ data: { signedUrl: 'https://fake.local/' + bucket + '/' + path + '?signed=1' }, error: null }),
      download: async (path) => ({ data: files.get(path) || null, error: files.has(path) ? null : { message: 'not found' } }),
    };
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

class FakeAuth {
  constructor(user) { this.user = user || null; this.session = user ? { user, access_token: 'fake' } : null; this.log = []; this._subs = []; }
  async getUser() { this.log.push('getUser'); return { data: { user: this.user }, error: this.user ? null : { message: 'not authenticated' } }; }
  async getSession() { this.log.push('getSession'); return { data: { session: this.session }, error: null }; }
  async signInWithOtp(args) { this.log.push(['signInWithOtp', args]); return { data: {}, error: null }; }
  async verifyOtp(args) { this.log.push(['verifyOtp', args]); return { data: { user: this.user, session: this.session }, error: null }; }
  async signOut() { this.log.push('signOut'); this.user = null; this.session = null; return { error: null }; }
  async setSession(s) { this.log.push('setSession'); this.session = s; this.user = s && s.user; return { data: { session: s }, error: null }; }
  onAuthStateChange(cb) { this._subs.push(cb); return { data: { subscription: { unsubscribe: () => {} } } }; }
  /** Test helper: simulate a signed-in user. */
  setUser(u) { this.user = u; this.session = u ? { user: u, access_token: 'fake' } : null; return this; }
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

class FakeChannel {
  constructor(name) { this.name = name; this.handlers = []; this.subscribed = false; }
  on(type, filter, cb) { this.handlers.push({ type, filter, cb: typeof filter === 'function' ? filter : cb }); return this; }
  subscribe(cb) {
    this.subscribed = true;
    if (cb) cb('SUBSCRIBED');
    return this;
  }
  unsubscribe() { this.subscribed = false; return Promise.resolve('ok'); }
  /** Test helper: deliver a synthetic postgres change. */
  emit(table, eventType, record) {
    let delivered = 0;
    for (const h of this.handlers) {
      if (h.type !== 'postgres_changes' && h.type !== undefined) continue;
      delivered++;
      h.cb({ eventType, new: record, old: record, table, schema: 'public' });
    }
    return delivered;
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

class FakeSupabase {
  constructor(opts) {
    opts = opts || {};
    this.db = new FakeDB(opts.seed);
    this.storage = new FakeStorage();
    this.auth = new FakeAuth(opts.user);
    this.channels = [];
    this.log = [];
  }
  from(table) {
    this.log.push(['from', table]);
    return new FakeQuery(this.db, table, 'select');
  }
  channel(name) {
    this.log.push(['channel', name]);
    const ch = new FakeChannel(name);
    this.channels.push(ch);
    return ch;
  }
  removeChannel(ch) { return Promise.resolve('ok'); }
  removeAllChannels() { this.channels.length = 0; return Promise.resolve('ok'); }
  getChannels() { return this.channels.slice(); }
  /** Test helper: the last channel created, to emit into it. */
  lastChannel() { return this.channels[this.channels.length - 1] || null; }
}

module.exports = { FakeSupabase, FakeDB, FakeQuery, FakeStorage, FakeAuth, FakeChannel, loose, sortRows, likeMatch };
