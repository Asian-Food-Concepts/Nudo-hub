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

  t.test('VIEW-AS: only level 1 may open the picker, everyone else still sees it', () => {
    // The level check now lives in the mayUseViewAs predicate (tested behaviourally below),
    // so this asserts the WIRING: both entry points route through it, and the button is
    // visible-but-disabled for non-owners.
    const i = CODE.indexOf("closest('#viewas-open')");
    t.ok(i !== -1, 'the open button handler is missing');
    const openBody = CODE.slice(i, i + 220);
    t.includes(openBody, 'mayUseViewAs(VIEW_AS_ENABLED, realLevel())',
               'the open handler must delegate to the authorization predicate');
    t.includes(openBody, "closest('#user-name')",
               'the name-tap entry point must be in the same gated branch');
    // The button must NOT be hidden for non-owners — Ben wants everyone to see it.
    t.ok(!/vo\.classList\.toggle\('hidden', realLevel\(\) !== 1\)/.test(SRC),
         'the non-owner path must not HIDE the button (Ben: everyone should see it)');
    t.ok(/const allowed = realLevel\(\) === 1;/.test(SRC),
         'the enabled branch must compute an owner-only `allowed` flag');
    // The button ships with `hidden` in its markup, so the ENABLED branch is the only thing
    // that can reveal it — for the owner AND for the non-owner who must merely see it greyed.
    // Deleting that one call makes the button invisible to everyone, silently removing the
    // feature Ben asked to have fixed. Asserted on the enabled branch specifically, because
    // the disabled branch has its own show call and would mask the loss.
    const a = SRC.indexOf('const allowed = realLevel() === 1;');
    t.ok(a !== -1, 'the allowed flag is missing');
    const elseAt = SRC.lastIndexOf('} else {', a);
    t.ok(elseAt !== -1 && elseAt < a, 'could not locate the else block opening');
    let depth = 0, end = elseAt;
    for (let k = elseAt + 7; k < SRC.length; k++) {
      if (SRC[k] === '{') depth++;
      else if (SRC[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    const enabledBranch = SRC.slice(elseAt, end + 1);
    t.ok(enabledBranch.length > 80 && enabledBranch.length < 1200,
         'the enabled branch was not isolated cleanly (len ' + enabledBranch.length + ')');
    t.includes(enabledBranch, 'const allowed', 'the isolated block must be the enabled branch');
    t.includes(enabledBranch, "vo.classList.remove('hidden')",
               'the ENABLED branch must reveal the button — it ships hidden in markup, so '
               + 'without this call the feature is invisible to everyone');
    t.ok(!/classList\.(add|toggle)\('hidden'\s*(,\s*[^)]*)?\)/.test(enabledBranch),
         'the enabled branch must never HIDE the button for a non-owner');
    // And the ship state itself: `hidden` in the markup is fine only because loadUser shows it.
    t.ok(/class="viewas-open hidden"|class="[^"]*\bhidden\b[^"]*"[^>]*id="viewas-open"/.test(HTML),
         'the button is expected to start hidden and be revealed by loadUser');
  });

  t.test('VIEW-AS: the owner does not get a not-allowed cursor', () => {
    // The exact defect Ben reported: cursor 'not-allowed' on his own button.
    const i = SRC.indexOf('const allowed = realLevel() === 1;');
    t.ok(i !== -1, 'the allowed flag is missing');
    const tail = SRC.slice(i, i + 400);
    t.ok(/cursor = allowed \? '' : 'not-allowed'/.test(tail),
         "the cursor must be cleared for the owner and 'not-allowed' only otherwise");
    t.ok(/vo\.disabled = !allowed;/.test(tail), 'the button must be enabled for the owner');
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
