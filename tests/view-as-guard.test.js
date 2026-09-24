/**
 * BEHAVIOURAL tests for the "Visto como" write guard.
 *
 * WHY THIS FILE EXISTS INSTEAD OF MORE STRING CHECKS
 *
 * The first version of these tests asserted the guard's TEXT — that the source mentions
 * `supabase.storage`, `signOut`, `functions/v1/`. Mutation testing proved that worthless: I
 * replaced each guard's condition with `if (false)`, disabling the protection completely, and
 * all three tests still passed, because the dead code still CONTAINED the strings. A test that
 * passes against a guard that does nothing is worse than no test, because it buys confidence.
 *
 * So this file EXECUTES installWriteGuard against a fake supabase client and a fake fetch, and
 * asserts what actually happens to a write:
 *   - impersonating  -> every write path is refused with the read-only error
 *   - not impersonating -> every write path reaches the client normally
 *
 * The last point is not decoration: wrapping a client is permanent, so a guard that decided
 * once at install time would leave real uploads and sign-out permanently broken after the
 * owner stepped out of the preview. That exact bug was in the first draft of the fix.
 */

module.exports = function (t) {
  const guardSrc = t.extractFunction('installWriteGuard') || '';

  /** A fake supabase client that records what was called. */
  function fakeSupabase() {
    const calls = [];
    const chain = (label) => {
      const q = { __label: label };
      ['insert', 'update', 'upsert', 'delete'].forEach((m) => {
        q[m] = (...a) => { calls.push(label + '.' + m); return Promise.resolve({ data: 'WROTE', error: null }); };
      });
      q.select = () => q;
      q.eq = () => q;
      return q;
    };
    const supabase = {
      from: (tbl) => chain(tbl),
      storage: {
        from: (bucket) => ({
          upload: (...a) => { calls.push(bucket + '.upload'); return Promise.resolve({ data: 'UPLOADED', error: null }); },
          remove: (...a) => { calls.push(bucket + '.remove'); return Promise.resolve({ data: 'REMOVED', error: null }); },
          createSignedUrl: (...a) => { calls.push(bucket + '.sign'); return Promise.resolve({ data: 'URL', error: null }); },
        }),
      },
      auth: {
        signOut: () => { calls.push('auth.signOut'); return Promise.resolve({ error: null }); },
        signInWithOtp: () => { calls.push('auth.signInWithOtp'); return Promise.resolve({ error: null }); },
        getSession: () => { calls.push('auth.getSession'); return Promise.resolve({ data: { session: null } }); },
      },
    };
    return { supabase, calls };
  }

  /** Install the REAL guard source over a fake client, in an isolated scope. */
  function build(impersonating) {
    const { supabase, calls } = fakeSupabase();
    const fakeWindow = {
      fetch: (input, init) => {
        calls.push('fetch:' + ((init && init.method) || 'GET') + ':' + String(input).slice(0, 40));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      },
    };
    const factory = new Function(
      'supabaseRef', 'state', 'windowRef', 'ResponseRef', `
        let VIEW_AS = state.VIEW_AS;
        let __writeGuardOn = false;
        const VIEW_AS_BLOCK = {
          data: null,
          error: { message: 'Modo "Visto como" es de solo lectura. Toca "Salir" para poder editar.' }
        };
        const supabase = supabaseRef;
        const window = windowRef;
        const Response = ResponseRef;
        ${guardSrc}
        return {
          install: installWriteGuard,
          setViewAs: (v) => { VIEW_AS = v; },
          client: () => supabase,
        };
      `);
    // `window.__origFetch` is set by the guard itself, so the fake must be the wrapper target.
    const api = factory(supabase, { VIEW_AS: impersonating }, fakeWindow, Response);
    api.__calls = calls;
    api.__window = fakeWindow;
    return api;
  }

  function isRefused(res) {
    return !!(res && res.error && /solo lectura/.test(res.error.message));
  }

  t.test('GUARD (behaviour): while impersonating, every supabase write is REFUSED', async () => {
    const api = build(true);
    api.install();
    const c = api.client();
    t.ok(isRefused(await c.from('shifts').insert({})), 'insert must be refused');
    t.ok(isRefused(await c.from('shifts').update({})), 'update must be refused');
    t.ok(isRefused(await c.from('shifts').upsert({})), 'upsert must be refused');
    t.ok(isRefused(await c.from('shifts').delete()), 'delete must be refused');
  });

  t.test('GUARD (behaviour): while impersonating, a storage UPLOAD is REFUSED', async () => {
    const api = build(true);
    api.install();
    const res = await api.client().storage.from('maintenance-photos').upload('p', {});
    t.ok(isRefused(res), 'storage upload must be refused — it is a real write');
    t.ok(api.__calls.indexOf('maintenance-photos.upload') === -1,
         'the underlying upload must never have run');
  });

  t.test('GUARD (behaviour): while impersonating, AUTH is REFUSED', async () => {
    const api = build(true);
    api.install();
    t.ok(isRefused(await api.client().auth.signOut()),
         'signOut must be refused — it would drop the real owner session');
    t.ok(api.__calls.indexOf('auth.signOut') === -1, 'the real signOut must never have run');
    // Reads must still work, or the preview cannot load anything.
    await api.client().auth.getSession();
    t.ok(api.__calls.indexOf('auth.getSession') !== -1, 'getSession must still work');
  });

  t.test('GUARD (behaviour): while impersonating, a write via fetch is REFUSED', async () => {
    const api = build(true);
    api.install();
    const post = await api.__window.fetch('https://x.supabase.co/functions/v1/generate-contract',
                                          { method: 'POST' });
    t.eq(post.status, 403, 'a POST to an edge function must return 403');
    const postRest = await api.__window.fetch('https://x.supabase.co/rest/v1/shifts',
                                              { method: 'PATCH' });
    t.eq(postRest.status, 403, 'a PATCH to REST must return 403');
    // A GET must pass through, or nothing can be read in the preview.
    const get = await api.__window.fetch('https://x.supabase.co/rest/v1/shifts');
    t.eq(get.status, 200, 'a GET must pass through');
    t.ok(api.__calls.some((c2) => c2.startsWith('fetch:GET')),
         'the GET must have reached the real fetch');
  });

  t.test('GUARD (behaviour): writes are ALLOWED again after leaving the preview', async () => {
    // The regression this pins: a guard that captured its decision at install time would
    // leave uploads and sign-out broken forever once the owner stepped out.
    const api = build(true);
    api.install();
    api.setViewAs(null);                       // owner taps "Salir"
    const c = api.client();
    const upd = await c.from('shifts').update({});
    t.eq(upd.data, 'WROTE', 'update must reach the client once not impersonating');
    const up = await c.storage.from('maintenance-photos').upload('p', {});
    t.eq(up.data, 'UPLOADED', 'storage upload must work again');
    const so = await c.auth.signOut();
    t.eq(so.error, null, 'signOut must work again');
    t.ok(api.__calls.indexOf('auth.signOut') !== -1, 'the real signOut must have run');
  });

  t.test('GUARD (behaviour): a NOT-impersonating session is never affected', async () => {
    const api = build(false);
    api.install();
    const c = api.client();
    t.eq((await c.from('shifts').update({})).data, 'WROTE', 'update must pass through');
    t.eq((await c.storage.from('b').upload('p', {})).data, 'UPLOADED', 'upload must pass through');
    t.eq((await c.auth.signOut()).error, null, 'signOut must pass through');
    const r = await api.__window.fetch('https://x.supabase.co/functions/v1/manage-user',
                                       { method: 'POST' });
    t.eq(r.status, 200, 'a POST must pass through when not impersonating');
  });

  t.test('GUARD (behaviour): installing twice does not double-wrap', async () => {
    const api = build(true);
    api.install();
    api.install();
    t.ok(isRefused(await api.client().from('x').insert({})), 'still refused after a 2nd install');
    api.setViewAs(null);
    t.eq((await api.client().from('x').insert({})).data, 'WROTE',
         'a double-wrap must not break the allowed path');
  });

  t.test('GUARD (behaviour): a signed-URL read still works while impersonating', async () => {
    // Viewing a document is the whole point of the preview — it must not be blocked.
    const api = build(true);
    api.install();
    const res = await api.client().storage.from('onboarding-documents').createSignedUrl('p', 60);
    t.eq(res.data, 'URL', 'createSignedUrl is a read and must pass through');
  });
};
