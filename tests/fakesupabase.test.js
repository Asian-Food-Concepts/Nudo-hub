/**
 * THE FAKE SUPABASE'S OWN TESTS.
 *
 * Same reasoning as fakedom.test.js: a fake that quietly lies makes the app look
 * correct while testing nothing. The specific danger here is sharper than with
 * the DOM, because the bugs this fake exists to catch are SUBTLE:
 *
 *   - an RLS-blocked UPDATE does NOT raise. It returns no error and changes no
 *     rows. A fake that throws, or that reports the change, cannot reproduce the
 *     bug that silently falsified a purchase's status.
 *   - a write that reports success while saving nothing must be representable.
 *   - .maybeSingle() must yield null for zero rows and an OBJECT for one, because
 *     the app destructures the result directly.
 *
 * Every one of these is asserted below, against the fake, before the fake is
 * trusted to test app.html.
 */

const { FakeSupabase } = require('./fakesupabase.js');

module.exports = function (t) {
  const mk = (seed, opts) => new FakeSupabase(Object.assign({ seed }, opts || {}));

  const SEED = {
    profiles: [
      { id: 'p1', name: 'Ana', role: 'Dueño', branch: 'Roma Norte', level: 1 },
      { id: 'p2', name: 'Beto', role: 'Capitán', branch: 'Del Valle', level: 4 },
      { id: 'p3', name: 'Ceci', role: 'Staff', branch: 'Roma Norte', level: 6 },
    ],
  };

  // =========================================================================
  // Reads
  // =========================================================================
  t.test('SB: select returns all rows', async () => {
    const sb = mk(SEED);
    const { data, error } = await sb.from('profiles').select('*');
    t.eq(error, null);
    t.eq(data.length, 3);
  });

  t.test('SB: eq filters, and chaining two eq is an AND', async () => {
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('*').eq('branch', 'Roma Norte');
    t.eq(data.length, 2);
    const two = await sb.from('profiles').select('*').eq('branch', 'Roma Norte').eq('role', 'Staff');
    t.eq(two.data.length, 1);
    t.eq(two.data[0].name, 'Ceci');
  });

  t.test('SB: unknown table yields [] rather than throwing', async () => {
    // The app has a real table list; an unseeded one is empty, not fatal.
    const sb = mk(SEED);
    const { data, error } = await sb.from('bitacora').select('*');
    t.eq(error, null);
    t.eq(data.length, 0);
  });

  t.test('SB: order sorts ascending and descending', async () => {
    const sb = mk(SEED);
    const asc = await sb.from('profiles').select('*').order('name');
    t.eq(asc.data[0].name, 'Ana');
    const desc = await sb.from('profiles').select('*').order('name', { ascending: false });
    t.eq(desc.data[0].name, 'Ceci');
  });

  t.test('SB: order then limit takes the top N of the SORTED set', async () => {
    // Ordering after limiting would give the wrong roster slice — a real bug shape.
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('*').order('level').limit(2);
    t.eq(data.length, 2);
    t.eq(data[0].name, 'Ana', 'lowest level first');
    t.eq(data[1].name, 'Beto');
  });

  t.test('SB: single returns an OBJECT; maybeSingle returns object or null', async () => {
    const sb = mk(SEED);
    const one = await sb.from('profiles').select('*').eq('id', 'p1').single();
    t.eq(typeof one.data, 'object');
    t.eq(one.data.id, 'p1');
    t.eq(one.error, null);
    // maybeSingle with no match is null data and NO error — this is the shape the
    // app destructures 16 times, so getting it wrong breaks every lookup silently.
    const none = await sb.from('profiles').select('*').eq('id', 'nope').maybeSingle();
    t.eq(none.data, null);
    t.eq(none.error, null, 'maybeSingle must NOT error on zero rows');
  });

  t.test('SB: single with zero rows IS an error (unlike maybeSingle)', async () => {
    const sb = mk(SEED);
    const r = await sb.from('profiles').select('*').eq('id', 'nope').single();
    t.eq(r.data, null);
    t.ok(r.error, 'single() must error when no row matches');
    t.eq(r.error.code, 'PGRST116');
  });

  t.test('SB: gte/lte form a range', async () => {
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('*').gte('level', 2).lte('level', 5);
    t.eq(data.length, 1);
    t.eq(data[0].name, 'Beto');
  });

  t.test('SB: in matches a set', async () => {
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('*').in('id', ['p1', 'p3']);
    t.eq(data.length, 2);
  });

  t.test('SB: is(null) matches SQL NULL', async () => {
    const sb = mk({ profiles: [{ id: 'a', name: 'A', deleted_at: null }, { id: 'b', name: 'B', deleted_at: '2026-01-01' }] });
    const { data } = await sb.from('profiles').select('*').is('deleted_at', null);
    t.eq(data.length, 1);
    t.eq(data[0].id, 'a');
  });

  t.test('SB: contains works on an array and on a jsonb object', async () => {
    const sb = mk({ t: [
      { id: '1', tags: ['a', 'b'] },
      { id: '2', tags: ['b'] },
      { id: '3', meta: { hidden: true } },
    ] });
    const arr = await sb.from('t').select('*').contains('tags', ['a']);
    t.eq(arr.data.length, 1);
    t.eq(arr.data[0].id, '1');
    const obj = await sb.from('t').select('*').contains('meta', { hidden: true });
    t.eq(obj.data.length, 1);
    t.eq(obj.data[0].id, '3');
  });

  t.test('SB: ilike is case-insensitive with %', async () => {
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('*').ilike('name', '%an%');
    t.eq(data.length, 1, 'ilike should match "Ana" for %an%');
  });

  t.test('SB: match applies every key as eq', async () => {
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('*').match({ branch: 'Roma Norte', role: 'Staff' });
    t.eq(data.length, 1);
  });

  // =========================================================================
  // Writes — these must REALLY mutate
  // =========================================================================
  t.test('SB: insert adds a row and it is readable afterwards', async () => {
    const sb = mk(SEED);
    const ins = await sb.from('profiles').insert({ name: 'Dani', branch: 'Del Valle' });
    t.eq(ins.error, null);
    const all = await sb.from('profiles').select('*');
    t.eq(all.data.length, 4, 'insert did not persist');
    t.ok(all.data.some((r) => r.name === 'Dani'));
  });

  t.test('SB: insert assigns an id if absent (so a later update can target it)', async () => {
    const sb = mk(SEED);
    await sb.from('profiles').insert({ name: 'Dani' });
    const back = await sb.from('profiles').select('*').eq('name', 'Dani').maybeSingle();
    t.ok(back.data.id, 'inserted row has no id — nothing could ever update it');
  });

  t.test('SB: update mutates ONLY matching rows and reports them', async () => {
    const sb = mk(SEED);
    const r = await sb.from('profiles').update({ branch: 'Ambos' }).eq('id', 'p2').select();
    t.eq(r.error, null);
    t.eq(r.data.length, 1);
    const check = await sb.from('profiles').select('*').eq('id', 'p2').single();
    t.eq(check.data.branch, 'Ambos');
    const other = await sb.from('profiles').select('*').eq('id', 'p1').single();
    t.eq(other.data.branch, 'Roma Norte', 'a non-matching row must be untouched');
  });

  t.test('SB: update on a non-matching filter changes nothing, with NO error', async () => {
    // This is the RLS behaviour the app was bitten by: the DB silently does
    // nothing and reports success.
    const sb = mk(SEED);
    const r = await sb.from('profiles').update({ role: 'Dueño' }).eq('id', 'does-not-exist').select();
    t.eq(r.error, null, 'a zero-row update must not raise');
    t.eq(r.data.length, 0, 'the caller must be able to SEE that nothing changed');
  });

  t.test('SB: silentZeroRows reproduces an RLS-filtered write', async () => {
    const sb = mk(SEED);
    sb.db.silentZeroRows('profiles');
    const r = await sb.from('profiles').update({ role: 'x' }).eq('id', 'p1').select();
    t.eq(r.error, null, 'an RLS-filtered write reports success');
    t.eq(r.data.length, 0, 'but changed nothing — this is the invisible failure');
    const after = await sb.from('profiles').select('*').eq('id', 'p1').single();
    t.eq(after.data.role, 'Dueño', 'the row must genuinely be unchanged');
  });

  t.test('SB: failNextWrite reproduces an RLS DENIAL (which does raise)', async () => {
    const sb = mk(SEED);
    sb.db.failNextWrite('profiles');
    const r = await sb.from('profiles').insert({ name: 'Nope' });
    t.ok(r.error, 'a denied insert must return an error object');
    t.eq(r.error.code, '42501');
    // And the failure is one-shot, so the next write succeeds.
    const ok = await sb.from('profiles').insert({ name: 'Yes' });
    t.eq(ok.error, null);
  });

  t.test('SB: upsert inserts when absent and updates on conflict', async () => {
    const sb = mk({ shifts: [{ id: 's1', slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Roma Norte', staff_id: 'p1' }] });
    // onConflict mirrors the app's real 'branch,slot,shift_date' unique index
    const upd = await sb.from('shifts').upsert(
      { slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Roma Norte', staff_id: 'p2' },
      { onConflict: 'branch,slot,shift_date' }
    );
    t.eq(upd.error, null);
    const all = await sb.from('shifts').select('*');
    t.eq(all.data.length, 1, 'upsert must UPDATE the conflicting row, not add a second');
    t.eq(all.data[0].staff_id, 'p2');

    await sb.from('shifts').upsert(
      { slot: 'Capitán 2', shift_date: '2026-09-22', branch: 'Roma Norte', staff_id: 'p3' },
      { onConflict: 'branch,slot,shift_date' }
    );
    const two = await sb.from('shifts').select('*');
    t.eq(two.data.length, 2, 'a genuinely new key must INSERT');
  });

  t.test('SB: delete removes only matching rows and returns them', async () => {
    const sb = mk(SEED);
    const r = await sb.from('profiles').delete().eq('id', 'p3').select();
    t.eq(r.data.length, 1);
    const left = await sb.from('profiles').select('*');
    t.eq(left.data.length, 2);
  });

  t.test('SB: a delete that matches nothing removes nothing (no cascade surprise)', async () => {
    const sb = mk(SEED);
    await sb.from('profiles').delete().eq('id', 'not-there');
    const left = await sb.from('profiles').select('*');
    t.eq(left.data.length, 3, 'a non-matching delete must be inert');
  });

  t.test('SB: count/head returns a count without data', async () => {
    const sb = mk(SEED);
    const r = await sb.from('profiles').select('*', { count: 'exact', head: true });
    t.eq(r.count, 3);
    t.eq(r.data, null);
  });

  t.test('SB: select(cols) projects to ONLY those columns', async () => {
    // A fake that returns the whole row hides a real bug: the app reading a field it
    // never requested works in a test and returns undefined in production.
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('level').eq('id', 'p1').maybeSingle();
    t.eq(data.level, 1, 'the requested column must be present');
    t.eq(data.name, undefined, 'an unrequested column must NOT be returned');
    t.eq(data.branch, undefined, 'projection must drop every other column');
  });

  t.test('SB: select with a JSON path keeps the leaf reachable', async () => {
    const sb = mk({ t: [{ id: '1', meta: { a: 1, b: 2 } }] });
    const { data } = await sb.from('t').select('meta.a');
    t.eq(data[0]['meta.a'], 1, 'a dotted select must expose the leaf');
  });

  t.test('SB: projection still applies through filters and order', async () => {
    // Projection must happen AFTER filtering, or an eq on an unselected column
    // would silently match nothing.
    const sb = mk(SEED);
    const { data } = await sb.from('profiles').select('name').eq('branch', 'Roma Norte').order('name');
    t.eq(data.length, 2, 'filtering on an unselected column must still work');
    t.eq(data[0].name, 'Ana');
    t.eq(data[0].branch, undefined, 'and the filter column must not leak into the result');
  });

  // =========================================================================
  // Thenable behaviour — the app awaits these directly
  // =========================================================================
  t.test('SB: the builder is awaitable AND supports .then/.catch', async () => {
    const sb = mk(SEED);
    const viaAwait = await sb.from('profiles').select('*');
    t.eq(viaAwait.data.length, 3);
    const viaThen = await sb.from('profiles').select('*').then((r) => r.data.length);
    t.eq(viaThen, 3);
    const caught = await sb.from('profiles').select('*').then(() => { throw new Error('x'); }).catch((e) => e.message);
    t.eq(caught, 'x', '.catch must be reachable without a network');
  });

  t.test('SB: re-awaiting the same builder returns the same result (not re-run)', async () => {
    // The app sometimes holds a query; re-executing it on each await would make a
    // write happen twice.
    const sb = mk(SEED);
    const q = sb.from('profiles').select('*');
    const a = await q;
    const b = await q;
    t.eq(a.data.length, b.data.length);
    t.eq(sb.db.log.filter((l) => l.op === 'select').length, 1, 'the query ran twice');
  });

  // =========================================================================
  // Storage
  // =========================================================================
  t.test('SB: storage upload then list then getPublicUrl', async () => {
    const sb = mk();
    await sb.storage.from('maintenance-photos').upload('foto.jpg', 'data');
    const list = await sb.storage.from('maintenance-photos').list();
    t.eq(list.data.length, 1);
    const url = sb.storage.from('maintenance-photos').getPublicUrl('foto.jpg').data.publicUrl;
    t.includes(url, 'maintenance-photos/foto.jpg');
  });

  // =========================================================================
  // Auth
  // =========================================================================
  t.test('SB: auth.getUser returns the signed-in user shape', async () => {
    const sb = mk(SEED, { user: { id: 'p1', email: 'nudo@asianfoodconcepts.mx' } });
    const { data: { user } } = await sb.auth.getUser();
    t.eq(user.id, 'p1', 'the app destructures data.user directly');
  });

  t.test('SB: auth.getUser with no session returns null user, not a throw', async () => {
    const sb = mk(SEED);
    const res = await sb.auth.getUser();
    t.eq(res.data.user, null);
    t.ok(res.error, 'an unauthenticated getUser reports an error');
  });

  t.test('SB: signOut clears the session', async () => {
    const sb = mk(SEED, { user: { id: 'p1' } });
    await sb.auth.signOut();
    const res = await sb.auth.getUser();
    t.eq(res.data.user, null);
  });

  // =========================================================================
  // Realtime
  // =========================================================================
  t.test('SB: a channel subscribes and can deliver a postgres change', async () => {
    const sb = mk(SEED);
    let got = null;
    sb.channel('app-live').on('postgres_changes', { event: '*', schema: 'public', table: 'bitacora' }, (payload) => { got = payload; }).subscribe();
    t.eq(sb.lastChannel().subscribed, true);
    const n = sb.lastChannel().emit('bitacora', 'INSERT', { id: 'b1' });
    t.eq(n, 1, 'the handler was not called');
    t.eq(got.eventType, 'INSERT');
    t.eq(got.new.id, 'b1');
  });

  // =========================================================================
  // SAFETY: the fake cannot transmit
  // =========================================================================
  t.test('SB: the fake client makes NO network calls (no fetch in its source)', () => {
    const src = require('fs').readFileSync(require('path').join(t.ROOT, 'tests', 'fakesupabase.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    t.ok(!/[^.\w]fetch\s*\(/.test(code), 'fakesupabase.js calls fetch()');
    t.ok(!/require\s*\(\s*['"](?:net|http|https|tls|dns|dgram)['"]/.test(code), 'fakesupabase.js requires a network module');
    t.ok(!/XMLHttpRequest|WebSocket/.test(code), 'fakesupabase.js opens a socket');
  });

  // =========================================================================
  // THE RUNNER ITSELF — async tests must not pass vacuously
  // =========================================================================
  t.test('SAFETY: the harness catches a FAILING async test (not a vacuous pass)', async () => {
    // THE most important test in this file.
    //
    // The runner was synchronous (`try { fn(); pass++ }`). An async test returns a
    // promise, `fn()` does not throw, so the test counted as a pass IMMEDIATELY and
    // a later rejection was an invisible unhandled promise. Every async test would
    // have passed unconditionally — including every Supabase test above.
    //
    // ASSERT ON THE SPECIFIC RECORDED FAILURE, not on a count delta: a delta is
    // contaminated by every other test finishing during the same drain, which made
    // this probe report a false failure as soon as an unrelated test failed. The
    // probe must be reliable precisely because it is the one guarding all the others.
    const PROBE = '__probe_async_failure__';
    t.test(PROBE, async () => { throw new Error('async failure probe'); });
    await t.settle();
    const found = t.results.failures.filter((x) => x.name === PROBE);
    t.eq(found.length, 1, 'a rejecting async test was NOT recorded as a failure — async tests are vacuous');
    t.includes(found[0].message, 'async failure probe', 'the failure message must survive');
    // Clean up so the probe does not pollute the run's tally.
    t.results.fail -= 1;
    t.results.failures = t.results.failures.filter((x) => x.name !== PROBE);
  });

  t.test('SAFETY: the harness counts a PASSING async test exactly once', async () => {
    // Drain first so the delta belongs to the probe alone.
    await t.settle();
    const PROBE = '__probe_async_pass__';
    let ran = false;
    const before = t.results.pass;
    t.test(PROBE, async () => { await Promise.resolve(); ran = true; });
    await t.settle();
    t.eq(ran, true, 'the probe body did not actually run');
    t.eq(t.results.pass - before, 1, 'a passing async test must be counted exactly once');
    t.results.pass -= 1;
  });
};
