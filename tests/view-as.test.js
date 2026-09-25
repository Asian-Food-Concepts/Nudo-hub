/**
 * Guard "Visto como" — the owner-only read-only preview (enabled v0.209.12).
 *
 * WHY THESE ASSERTIONS EXIST
 *
 * 1. THE BUTTON MUST BE USABLE FOR THE OWNER. It existed but shipped DISABLED for everyone
 *    while VIEW_AS_ENABLED was false, so Ben — a level-1 Dueño — met a `not-allowed` cursor on
 *    his own control. A feature that is present-but-inert is worse than absent: it reads as a
 *    bug. The gate must be level 1 ONLY, and everyone else must still SEE it (his 2026-09-22
 *    order) while remaining unable to click it.
 *
 * 2. IMPERSONATION MUST NOT BE ABLE TO WRITE. Being able to SEE every screen is the point;
 *    being able to ACT as someone else would attribute their writes to them — shift_audit,
 *    bitacora.submitted_by, descanso_requests.staff_id would all record the wrong person,
 *    which is falsified HR data. The single `supabase.from()` choke point missed three real
 *    write paths, so each is now asserted directly:
 *      - supabase.storage.from(...).upload()  (maintenance photos)
 *      - supabase.auth.*                      (sign-out inside a preview would drop the
 *                                              real owner's session)
 *      - direct fetch() to /functions/v1/ and /rest/v1/ with a non-GET method
 *
 * 3. THE GUARD MUST BE REVERSIBLE. Wrapping a client is permanent — the app never unwraps. A
 *    wrapper that decided "blocked" once, at install time, would leave uploads and sign-out
 *    broken forever after the owner exited the preview. This bug was present in the first
 *    draft of the fix and is now pinned: every wrapper must read VIEW_AS at CALL time.
 */

module.exports = function (t) {
  const SRC = t.src;
  const HTML = t.html;
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const guard = t.extractFunction('installWriteGuard') || '';

  t.test('VIEW-AS: the feature is enabled', () => {
    t.ok(/const VIEW_AS_ENABLED = true;/.test(SRC),
         'VIEW_AS_ENABLED must be true or the button is inert for everyone');
  });

  t.test('VIEW-AS: non-owners must NOT see the button (Ben 2026-09-24)', () => {
    // Ben reversed the earlier "everyone should see it" order: "non owners should not see the
    // button, and they should not be able to access it." Three independent layers must hold,
    // because hiding alone is not a boundary.
    const a = SRC.indexOf("const vo = $('viewas-open');");
    t.ok(a !== -1, 'the visibility block is missing');
    // Brace-match the whole block so the assertions cannot pass on a fragment.
    let depth = 0, end = a;
    for (let k = SRC.indexOf('{', a); k < SRC.length; k++) {
      if (SRC[k] === '{') depth++;
      else if (SRC[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    const blk = SRC.slice(a, end + 1);
    t.ok(blk.length > 200 && blk.length < 3000, 'block isolation failed (len ' + blk.length + ')');

    // LAYER 1 — hidden for non-owners, shown for the owner.
    t.includes(blk, "vo.classList.add('hidden')", 'the non-owner branch must HIDE the button');
    t.includes(blk, "vo.classList.remove('hidden')", 'the owner branch must SHOW the button');
    t.ok(/if \(allowed\) \{/.test(blk), 'the block must branch on the authorization predicate');

    // LAYER 2 — unreachable even if something unhides it.
    t.includes(blk, "vo.setAttribute('inert', '')", 'the non-owner branch must set inert');
    t.includes(blk, "vo.disabled = true", 'the non-owner branch must disable it');
    t.includes(blk, "vo.removeAttribute('inert')", 'the owner branch must clear inert');

    // LAYER 3 — the predicate itself is the gate (tested behaviourally in the next test).
    t.includes(blk, 'mayUseViewAs(VIEW_AS_ENABLED, realLevel())',
               'the block must delegate to the authorization predicate');

    // The old "greyed out but visible" behaviour must be GONE — that was the bug Ben reported.
    t.ok(!/vo\.style\.opacity = '0\.5'/.test(blk),
         'the non-owner path must not render a greyed-out-but-visible button');
    t.ok(!/cursor = 'not-allowed'/.test(blk),
         'the non-owner path must not produce the not-allowed cursor Ben complained about');
  });

  t.test('VIEW-AS: the button starts hidden in markup', () => {
    // If it ever shipped visible by default, a non-owner would see it for the instant before
    // loadUser() runs — and on a slow connection that is long enough to tap.
    t.ok(/<button[^>]*class="viewas-open hidden"[^>]*id="viewas-open"/.test(HTML),
         'the button must ship with the `hidden` class');
  });

  t.test('VIEW-AS: both entry points route through the predicate', () => {
    // A user can open the picker from the button AND by tapping their own name in the header.
    // Both must go through the gate — a second ungated entry point would bypass everything.
    const i = CODE.indexOf("closest('#viewas-open')");
    t.ok(i !== -1, 'the open button handler is missing');
    const openBody = CODE.slice(i, i + 220);
    t.includes(openBody, 'mayUseViewAs(VIEW_AS_ENABLED, realLevel())',
               'the open handler must delegate to the authorization predicate');
    t.includes(openBody, "closest('#user-name')",
               'the name-tap entry point must be in the same gated branch');
  });

  t.test('VIEW-AS: the owner gets a live, normal-cursor button', () => {
    // The exact defect Ben reported: cursor 'not-allowed' on his own button. The new contract
    // is stronger — the owner's branch must actively CLEAR any prior inline styling, so a
    // leftover style from an earlier render cannot leave him staring at a dead-looking control.
    const i = SRC.indexOf("const vo = $('viewas-open');");
    t.ok(i !== -1, 'the visibility block is missing');
    const tail = SRC.slice(i, i + 1400);
    t.ok(/vo\.disabled = false;/.test(tail), 'the owner branch must ENABLE the button');
    t.ok(/vo\.removeAttribute\('inert'\)/.test(tail), 'the owner branch must clear inert');
    t.ok(/vo\.style\.cursor = '';/.test(tail),
         'the owner branch must reset the cursor — never inherit a not-allowed state');
    t.ok(!/cursor = 'not-allowed'/.test(tail),
         "the app must never set a not-allowed cursor anywhere in this block");
  });

  t.test('VIEW-AS: the authorization predicate is behavioural, not textual', () => {
    // mayUseViewAs is THE security gate. String assertions on a click handler could not see it
    // (mutation testing: deleting the level check left every test green), so it is a pure
    // function and is executed here against the real values the app will pass.
    const srcFn = t.extractFunction('mayUseViewAs') || '';
    t.ok(srcFn.length > 0, 'mayUseViewAs not found — the gate must be testable');
    const factory = new Function(srcFn + '\nreturn mayUseViewAs;');
    const may = factory();

    t.eq(may(true, 1), true, 'the owner (level 1) must be allowed');
    [2, 3, 4, 5, 6, 99, null, undefined, 0, -1, 'x'].forEach((lv) => {
      t.eq(may(true, lv), false, 'level ' + lv + ' must NOT be allowed');
    });
    t.eq(may(false, 1), false, 'even the owner must be blocked when the feature is disabled');
    // The predicate must be strict about the string form, because `level` comes from an
    // untyped DB row and "1" == 1 is true under a loose comparison.
    t.eq(may(true, '1'), true, 'a numeric string "1" from the DB is still the owner');
    t.eq(may(true, '01'), true, 'Number("01") is 1');
    t.eq(may(true, true), false, 'boolean true must not pass as level 1');
  });

  t.test('VIEW-AS: both entry points go through the predicate', () => {
    t.includes(CODE, 'mayUseViewAs(VIEW_AS_ENABLED, realLevel())',
               'the click handler must delegate to the predicate');
    const i = CODE.indexOf('closest(\'#viewas-open\')');
    const body = CODE.slice(i, i + 200);
    t.includes(body, "closest('#user-name')",
               'the name-tap entry point must be handled by the same gated branch');
  });

  t.test('VIEW-AS GUARD: supabase.from writes are blocked', () => {
    t.includes(guard, 'supabase.from', 'the from() guard is missing');
    ['insert', 'update', 'upsert', 'delete'].forEach((m) => {
      t.ok(new RegExp("'" + m + "'").test(guard), 'the from() guard must cover ' + m);
    });
  });

  t.test('VIEW-AS GUARD: storage uploads are blocked (bypass #1)', () => {
    t.includes(guard, 'supabase.storage', 'storage is not guarded — upload() would write');
    t.ok(/'upload'/.test(guard), "the storage guard must cover 'upload'");
  });

  t.test('VIEW-AS GUARD: auth is blocked (bypass #2)', () => {
    t.includes(guard, 'supabase.auth', 'auth is not guarded — sign-out would drop the session');
    t.ok(/'signOut'/.test(guard), "the auth guard must cover 'signOut'");
  });

  t.test('VIEW-AS GUARD: non-GET fetch to edge/REST is blocked (bypass #3)', () => {
    t.includes(guard, 'functions/v1/', 'the fetch guard must cover edge functions');
    t.includes(guard, 'rest/v1/', 'the fetch guard must cover the REST API');
    t.ok(/method !== 'GET'/.test(guard), 'the fetch guard must allow GET and block other methods');
  });

  t.test('VIEW-AS GUARD: every wrapper re-checks VIEW_AS at CALL time, not install time', () => {
    // The regression this exists for: a wrapper that captured the decision once would leave
    // uploads/sign-out broken forever after the owner exits the preview.
    t.ok(!/if \(!VIEW_AS\) return b;/.test(guard),
         'storage.from must not return early — methods must check at call time');
    const callChecks = (guard.match(/VIEW_AS \? Promise\.resolve\(VIEW_AS_BLOCK\)/g) || []).length;
    t.ok(callChecks >= 2,
         'storage and auth wrappers must each check VIEW_AS per call (found ' + callChecks + ')');
    t.includes(guard, 'const orig = b[m].bind(b);',
               'the original storage method must be preserved for the not-impersonating path');
    t.includes(guard, 'const orig = supabase.auth[m].bind(supabase.auth);',
               'the original auth method must be preserved');
  });

  t.test('VIEW-AS GUARD: it is installed before the preview is entered', () => {
    const enter = t.extractFunction('viewAsProfile') || '';
    t.ok(enter.length > 0, 'viewAsProfile not found');
    // The guard must be CALLED, and called before the profile is swapped. Note the explicit
    // presence check: `indexOf` returns -1 when installWriteGuard() is missing entirely, and
    // -1 < anything is true — so an absent call would satisfy a bare ordering assertion.
    const gIdx = enter.indexOf('installWriteGuard()');
    const pIdx = enter.indexOf('currentProfile = VIEW_AS');
    t.ok(gIdx !== -1, 'viewAsProfile must CALL installWriteGuard()');
    t.ok(pIdx !== -1, 'viewAsProfile must set currentProfile = VIEW_AS');
    t.ok(gIdx < pIdx, 'the guard must be installed BEFORE currentProfile is replaced');
  });

  t.test('VIEW-AS: exiting restores the real profile and re-runs the role gates', () => {
    const exit = t.extractFunction('exitViewAs') || '';
    t.ok(exit.length > 0, 'exitViewAs not found');
    t.includes(exit, '__realProfile', 'exit must restore the stashed real profile');
    t.includes(exit, 'loadUser()', 'exit must re-run loadUser so the owner gets his gates back');
    t.includes(HTML, 'id="viewas-exit"', 'the Salir button is missing from the markup');
    t.includes(HTML, 'id="viewas-banner"', 'the impersonation banner is missing');
  });

  t.test('VIEW-AS: the picker refuses to run when disabled and lists real profiles', () => {
    const pick = t.extractFunction('openViewAsPicker') || '';
    t.ok(pick.length > 0, 'openViewAsPicker not found');
    t.ok(/if \(!VIEW_AS_ENABLED\) return;/.test(pick),
         'the picker must refuse when the feature is disabled');
    t.includes(pick, "from('profiles')", 'the picker must read the real profile list');
  });
};
