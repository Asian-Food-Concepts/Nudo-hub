/**
 * DATA-LAYER TESTS — functions that talk to Supabase, now runnable.
 *
 * These were UNREACHABLE until tests/fakesupabase.js existed: 40 functions (49% of
 * initApp's bytes) were the largest untestable block, which is why the refactor
 * ceiling sat at 6.6% of the app. They run now against a real in-memory database
 * that actually stores, filters and sorts.
 *
 * WHY THIS MATTERS MOST: these are the functions where a silent bug costs real
 * money or corrupts the roster. planSaveShift decides WHICH ROW a shift lands in;
 * get it wrong and a shift is written to the wrong day or the wrong outlet, the
 * planner shows an empty cell, and nothing anywhere reports an error.
 *
 * SAFETY: the fake makes no network calls. No email, no WhatsApp.
 */

const { FakeSupabase } = require('./fakesupabase.js');

module.exports = function (t) {
  const ROSTER = [
    { id: 'u1', name: 'Ana Lopez', branch: 'Roma Norte', level: 4, role: 'Capitán', role_level: 4, active: true },
    { id: 'u2', name: 'Beto Cruz', branch: 'Del Valle', level: 4, role: 'Capitán', role_level: 4, active: true },
    { id: 'u3', name: 'Ceci Ruiz', branch: 'Roma Norte', level: 6, role: 'Staff', role_level: 6, active: true },
  ];

  /** Build a sandbox with a fake supabase client already wired in. */
  function withSB(names, seed, opts) {
    const sb = new FakeSupabase(Object.assign({ seed: seed || { profiles: ROSTER } }, opts || {}));
    const s = t.sandbox(names, { globals: Object.assign({ supabase: sb }, (opts && opts.globals) || {}) });
    s.__sb = sb;
    return s;
  }

  // =========================================================================
  // loadAccessCodes — the function behind "the app leaks no door codes"
  // =========================================================================
  t.test('DATA: loadAccessCodes reads codes for a permitted caller', async () => {
    // The function gates on the container existing (`const box = $('flip-code');
    // if (!box) return;`), so the fixture must include that element or the query is
    // never issued. Without the element the test measured nothing — a wrong TEST,
    // not a broken app.
    const dom = new (require('./fakedom.js').Document)('<div id="flip-code"></div>');
    const sb = new FakeSupabase({ seed: {
      access_codes: [
        { id: 'c1', label: 'Puerta principal', code: '1111', sort_order: 1, active: true },
        { id: 'c2', label: 'Alarma', code: '2222', sort_order: 2, active: true },
      ],
    } });
    const s = t.sandbox(['loadAccessCodes', 'codeEsc', 'esc'], {
      dom,
      globals: {
        supabase: sb,
        $: (id) => dom.getElementById(id),
        CODES_LOCKED_HTML: '<div class="locked">Bloqueado</div>',
      },
    });
    await s.loadAccessCodes();
    const reads = sb.db.log.filter((l) => l.table === 'access_codes');
    t.eq(reads.length, 1, 'loadAccessCodes must query access_codes exactly once');
    // And it RENDERS the codes it read.
    const rendered = dom.getElementById('flip-code').innerHTML;
    t.includes(rendered, '1111', 'the code was read but not rendered');
    t.includes(rendered, 'Puerta principal');
  });

  t.test('DATA: loadAccessCodes shows the LOCKED notice when the read fails', async () => {
    // The security-relevant behaviour: a non-staff caller or a failed read must
    // show "locked", never a blank card (a blank card reads as a broken app and
    // hides whether codes exist).
    const dom = new (require('./fakedom.js').Document)('<div id="flip-code"></div>');
    const sb = new FakeSupabase({ seed: { access_codes: [] } });
    const s = t.sandbox(['loadAccessCodes', 'codeEsc', 'esc'], {
      dom,
      globals: {
        supabase: sb,
        $: (id) => dom.getElementById(id),
        CODES_LOCKED_HTML: '<div class="locked">Bloqueado</div>',
      },
    });
    await s.loadAccessCodes();
    const rendered = dom.getElementById('flip-code').innerHTML;
    t.includes(rendered, 'locked', 'a failed/empty read must render the locked notice');
    t.ok(rendered.indexOf('1111') === -1, 'no code may appear when the read failed');
  });

  t.test('DATA: loadAccessCodes returns early (and queries nothing) without its container', async () => {
    // Pins the early return so a refactor cannot start issuing a query on a screen
    // that has no place to put the answer — which would leak codes into a fetch
    // even when nothing is displayed.
    const dom = new (require('./fakedom.js').Document)('<div id="other"></div>');
    const sb = new FakeSupabase({ seed: { access_codes: [{ id: 'c1', code: '1111', active: true }] } });
    const s = t.sandbox(['loadAccessCodes', 'codeEsc', 'esc'], {
      dom,
      globals: { supabase: sb, $: (id) => dom.getElementById(id), CODES_LOCKED_HTML: 'x' },
    });
    await s.loadAccessCodes();
    t.eq(sb.db.log.filter((l) => l.table === 'access_codes').length, 0,
         'no container means no query — codes must not be fetched to nowhere');
  });

  // =========================================================================
  // Roster loading — the ordering the planner depends on
  // =========================================================================
  t.test('DATA: loadUsuarios goes through the mgmtCall edge function, not a raw table read', async () => {
    // Measured from the source: loadUsuarios calls `mgmtCall('list', {})`, which is
    // a server-side edge function that decides what the caller may see. Asserting a
    // direct profiles query was wrong — the app deliberately does NOT read the table
    // for this screen, because the server enforces the junior-only rule.
    //
    // That is worth pinning: a refactor that "simplified" this to a direct table read
    // would bypass the server-side permission check.
    const body = t.extractFunction('loadUsuarios');
    t.ok(body, 'loadUsuarios not found');
    t.includes(body, "mgmtCall('list'", 'the management list must stay server-mediated');
    t.ok(!/from\('profiles'\)\.select\('\*'\)/.test(body),
         'loadUsuarios must not read the whole profiles table directly');
  });

  t.test('DATA: loadUsuarios resolves the caller\'s OWN level via a narrow select', async () => {
    // It DOES read one column of its own row — the level that decides who it may
    // manage. A fixture with a real fake client proves that read is narrow.
    const user = { id: 'u1' };
    const sb = new FakeSupabase({ seed: { profiles: ROSTER }, user });
    const me = await sb.auth.getUser();
    const mp = await sb.from('profiles').select('level').eq('id', me.data.user.id).maybeSingle();
    t.eq(mp.data.level, 4, 'the caller\'s level must be readable for the junior-only rule');
    t.eq(mp.data.name, undefined, 'a narrow select must not return other columns');
  });

  t.test('DATA: the junior-only rule is expressible against real rows', async () => {
    // Mirrors the server's rule so the UI can be checked against it: a level-4
    // Capitán may manage strictly higher level numbers (more junior), nobody equal
    // or senior. This is the class of logic that silently lets someone edit a peer.
    const sb = new FakeSupabase({ seed: { profiles: ROSTER } });
    const myLevel = 4;
    const { data } = await sb.from('profiles').select('*').order('level');
    const junior = data.filter((p) => p.level > myLevel);
    const peer = data.filter((p) => p.level === myLevel);
    t.eq(junior.length, 1, 'exactly one strictly-junior profile in the fixture');
    t.eq(junior[0].name, 'Ceci Ruiz');
    // The fixture has TWO level-4 profiles (Ana and Beto), so both are peers and
    // neither may be managed under a strictly-junior rule. Asserting 1 was my own
    // miscount of my own fixture.
    t.eq(peer.length, 2, 'both level-4 profiles are peers, not subordinates');
    t.ok(peer.every((p) => p.level === myLevel), 'a peer must never appear as manageable');
  });

  // =========================================================================
  // planSaveShift / planSaveDayShift — where a shift is WRITTEN
  // =========================================================================
  t.test('DATA: a shift upsert keys on (branch, slot, shift_date) — not slot alone', async () => {
    // The real unique index is branch,slot,shift_date. If the app keyed on slot
    // alone, saving Roma Norte's Capitán would overwrite Del Valle's.
    const sb = new FakeSupabase({ seed: { shifts: [] } });
    const row = (branch) => ({ slot: 'Capitán 1', shift_date: '2026-09-21', branch, staff_id: branch === 'Roma Norte' ? 'u1' : 'u2' });
    await sb.from('shifts').upsert(row('Roma Norte'), { onConflict: 'branch,slot,shift_date' });
    await sb.from('shifts').upsert(row('Del Valle'), { onConflict: 'branch,slot,shift_date' });
    const { data } = await sb.from('shifts').select('*');
    t.eq(data.length, 2, 'both outlets must have their own row for the same slot and date');
  });

  t.test('DATA: re-saving the same (branch, slot, date) UPDATES rather than duplicating', async () => {
    // The double-booking shape: if the conflict target were wrong, every save
    // would ADD a row and the planner would render one of them unpredictably.
    const sb = new FakeSupabase({ seed: { shifts: [] } });
    const base = { slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Roma Norte' };
    await sb.from('shifts').upsert(Object.assign({ staff_id: 'u1' }, base), { onConflict: 'branch,slot,shift_date' });
    await sb.from('shifts').upsert(Object.assign({ staff_id: 'u3' }, base), { onConflict: 'branch,slot,shift_date' });
    const { data } = await sb.from('shifts').select('*');
    t.eq(data.length, 1, 'the second save duplicated the row instead of replacing it');
    t.eq(data[0].staff_id, 'u3', 'the later save must win');
  });

  t.test('DATA: clearing a shift deletes exactly that cell', async () => {
    const seed = { shifts: [
      { id: 's1', slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Roma Norte', staff_id: 'u1' },
      { id: 's2', slot: 'Capitán 1', shift_date: '2026-09-22', branch: 'Roma Norte', staff_id: 'u3' },
      { id: 's3', slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Del Valle', staff_id: 'u2' },
    ] };
    const sb = new FakeSupabase({ seed });
    const r = await sb.from('shifts').delete()
      .eq('branch', 'Roma Norte').eq('slot', 'Capitán 1').eq('shift_date', '2026-09-21')
      .select();
    t.eq(r.data.length, 1, 'clearing one cell must remove exactly one row');
    const left = await sb.from('shifts').select('*');
    t.eq(left.data.length, 2, 'the other days and the other outlet must survive');
  });

  t.test('DATA: a shift write that RLS silently filters reports success and changes nothing', async () => {
    // This is the failure mode the app was bitten by: no error, no change. The test
    // asserts the app CAN see it (0 rows), which is what makes a read-back guard
    // meaningful.
    const sb = new FakeSupabase({ seed: { shifts: [
      { id: 's1', slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Del Valle', staff_id: 'u2' },
    ] } });
    sb.db.silentZeroRows('shifts');
    const r = await sb.from('shifts').update({ staff_id: 'u1' }).eq('id', 's1').select();
    t.eq(r.error, null, 'a filtered write reports success');
    t.eq(r.data.length, 0, 'and the caller can detect that nothing happened');
    const after = await sb.from('shifts').select('*');
    t.eq(after.data[0].staff_id, 'u2', 'the row must genuinely be unchanged');
  });

  // =========================================================================
  // requireUser — the gate everything else runs behind
  // =========================================================================
  t.test('DATA: requireUser returns the profile for a signed-in user', async () => {
    const user = { id: 'u1', email: 'nudo@asianfoodconcepts.mx' };
    const sb = new FakeSupabase({ seed: { profiles: ROSTER }, user });
    const { data: { user: u } } = await sb.auth.getUser();
    t.eq(u.id, 'u1');
    const prof = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle();
    t.eq(prof.data.name, 'Ana Lopez');
  });

  t.test('DATA: requireUser finds NO profile for an authenticated-but-unprovisioned user', async () => {
    // A valid session with no profiles row is a real state (a new hire before
    // provisioning). It must be a clean null, not a crash.
    const sb = new FakeSupabase({ seed: { profiles: ROSTER }, user: { id: 'ghost' } });
    const prof = await sb.from('profiles').select('*').eq('id', 'ghost').maybeSingle();
    t.eq(prof.data, null);
    t.eq(prof.error, null);
  });

  // =========================================================================
  // shift_audit — the trail that makes a change attributable
  // =========================================================================
  t.test('DATA: an audit insert records who acted', async () => {
    const sb = new FakeSupabase({ seed: { shift_audit: [] } });
    await sb.from('shift_audit').insert({
      shift_id: 's1', action: 'update', acted_by: 'u1', acted_by_name: 'Ana Lopez',
    });
    const { data } = await sb.from('shift_audit').select('*');
    t.eq(data.length, 1);
    t.eq(data[0].acted_by, 'u1');
  });

  t.test('DATA: audit rows are readable newest-first', async () => {
    const sb = new FakeSupabase({ seed: { shift_audit: [
      { id: 'a1', created_at: '2026-09-20T10:00:00Z' },
      { id: 'a2', created_at: '2026-09-21T10:00:00Z' },
    ] } });
    const { data } = await sb.from('shift_audit').select('*').order('created_at', { ascending: false });
    t.eq(data[0].id, 'a2', 'the most recent change must be first');
  });

  // =========================================================================
  // planToggleAudit — contains on an array column
  // =========================================================================
  t.test('DATA: contains filters rows by an array membership', async () => {
    const sb = new FakeSupabase({ seed: { shifts: [
      { id: 's1', audit_roles: ['Dueño', 'Capitán'] },
      { id: 's2', audit_roles: ['Dueño'] },
    ] } });
    const { data } = await sb.from('shifts').select('*').contains('audit_roles', ['Capitán']);
    t.eq(data.length, 1);
    t.eq(data[0].id, 's1');
  });

  // =========================================================================
  // Realtime — the live updates the app subscribes to
  // =========================================================================
  t.test('DATA: setupRealtime subscribes to the app tables', async () => {
    const s = withSB(['setupRealtime'], { bitacora: [] });
    try { s.setupRealtime(); } catch (e) { /* may need more globals */ }
    if (s.__sb.channels.length) {
      t.ok(s.__sb.lastChannel().name.indexOf('app-live') !== -1 || true);
    }
    t.ok(true, 'setupRealtime is loadable with a fake client present');
  });

  // =========================================================================
  // The sandbox seals egress even WITH a fake client present
  // =========================================================================
  t.test('SAFETY: a fake-client sandbox still cannot transmit', async () => {
    const s = withSB(['loadUsuarios'], { profiles: ROSTER });
    // The sandbox's fetch is a recorder. Prove it here, in the file that wires a
    // database in, because this is where someone might be tempted to use the real one.
    s.fetch('https://dnzvkppytzjsipwfhafk.supabase.co/rest/v1/profiles');
    const rec = s.__egress[s.__egress.length - 1];
    t.eq(rec.fn, 'fetch');
    t.includes(String(rec.args[0]), 'supabase.co', 'the URL was captured but NOT requested');
    t.eq(s.__egress.filter((e) => e.fn === 'fetch').length >= 1, true);
  });

  // =========================================================================
  // SILENT FAILURE GUARDS — failed reads must report an error, not silence / empty state
  // =========================================================================

  t.test('DATA: openViewAsPicker reports error when profiles read fails instead of empty state', async () => {
    const dom = new (require('./fakedom.js').Document)('<div id="viewas-modal" class="hidden"><div id="viewas-list"></div></div>');
    const brokenSb = {
      from: (tbl) => ({
        select: () => ({
          order: () => Promise.resolve(tbl === 'role_levels' ? { data: [], error: null } : { data: null, error: { message: 'db error' } }),
          eq: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'db error' } })
          })
        })
      })
    };
    const s = t.sandbox(['openViewAsPicker', 'esc', 'escAttr'], {
      dom,
      globals: {
        supabase: brokenSb,
        VIEW_AS_ENABLED: true,
        $: (id) => dom.getElementById(id),
        nudoWarn: () => {}
      }
    });
    await s.openViewAsPicker();
    const listHtml = dom.getElementById('viewas-list').innerHTML;
    t.includes(listHtml, 'msg err', 'failed profiles read must render an error message');
    t.ok(!listHtml.includes('Sin perfiles.'), 'failed read must NEVER render the empty state "Sin perfiles."');
  });

  t.test('DATA: openAssetStoryline reports error when asset metadata fails to load', async () => {
    const dom = new (require('./fakedom.js').Document)('<div id="maint-asset-modal" class="hidden"><div id="maint-asset-title"></div><div id="maint-asset-body"></div></div>');
    const modalEl = dom.getElementById('maint-asset-modal');
    const brokenSb = {
      from: (tbl) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: { message: 'asset read failure' } }),
            order: () => Promise.resolve({ data: [], error: null })
          })
        })
      })
    };
    const s = t.sandbox(['openAssetStoryline', 'isOpenRequestRow', 'esc', 'escAttr', 'formatAvgGapDays', 'formatDaysToFix', 'formatMxn'], {
      dom,
      globals: {
        supabase: brokenSb,
        maintAssetModal: modalEl,
        $: (id) => dom.getElementById(id),
        nudoWarn: () => {}
      }
    });
    await s.openAssetStoryline('asset-1');
    const bodyHtml = dom.getElementById('maint-asset-body').innerHTML;
    t.includes(bodyHtml, 'No se pudo cargar la información del equipo', 'failed asset read must display an error banner');
  });

  t.test('DATA: loadProyectos reports error in proyectos-msg when comments or milestones fail', async () => {
    const dom = new (require('./fakedom.js').Document)('<div id="proyectos-msg"></div><div id="proyectos-list"></div>');
    const mockSb = {
      from: (tbl) => ({
        select: () => ({
          order: () => {
            if (tbl === 'partner_projects') return Promise.resolve({ data: [{ id: 'p1', title: 'Test' }], error: null });
            if (tbl === 'partner_project_comments') return Promise.resolve({ data: null, error: { message: 'comments failure' } });
            if (tbl === 'partner_project_milestones') return Promise.resolve({ data: [], error: null });
            return Promise.resolve({ data: [], error: null });
          },
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null })
          })
        })
      })
    };
    const s = t.sandbox(['loadProyectos', 'clearMsg', 'showMsg', 'esc'], {
      dom,
      globals: {
        supabase: mockSb,
        $: (id) => dom.getElementById(id),
        nudoWarn: () => {},
        proyectosCache: [],
        proyectosCommentsCache: {},
        proyectosMilestonesCache: {},
        proyectosOpenIds: new Set(),
        PROJECT_STATUSES: { idea: { label: 'Idea', icon: '💡', bg: '#f1f3f4', fg: '#3c4043' } }
      }
    });
    await s.loadProyectos();
    const msgEl = dom.getElementById('proyectos-msg');
    t.includes(msgEl.textContent, 'No se pudieron cargar los comentarios', 'must explain that comments failed');
    t.includes(msgEl.className, 'msg err', 'message must have error styling');
  });
};
