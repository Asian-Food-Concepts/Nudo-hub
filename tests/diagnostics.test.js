/**
 * Tests for the diagnostics helpers and the attribution fallback.
 *
 * These were added by the silent-failure refactor. They assert the CONTRACT that
 * makes the refactor safe:
 *   - nudoWarn / nudoDiag NEVER throw, whatever they are given, because they are
 *     called from inside catch blocks. A diagnostic that can throw converts a
 *     cosmetic failure into a fatal one.
 *   - they stay SILENT unless window.__NUDO_DEBUG is set, so production staff do
 *     not get console noise.
 *   - attribution never invents a name: the old code fell back to the literal
 *     'Equipo', which is indistinguishable from a real record.
 */

module.exports = function (t) {
  const SRC = t.src;

  // The helpers are pure enough to load directly. `nudoDiag` references pushToast
  // and __nudoDiagOnce; the sandbox supplies a stub where needed.
  const s = t.sandbox(['nudoDebug', 'nudoWarn', 'nudoDiag']);

  t.test('nudoDebug returns false when the flag is unset', () => {
    t.eq(s.nudoDebug(), false);
  });

  t.test('nudoDebug does not throw when window is broken', () => {
    // A diagnostic must survive a hostile environment — it runs inside catch blocks.
    const saved = s.window;
    s.window = undefined;
    try {
      t.eq(s.nudoDebug(), false, 'must coerce a missing window to false, not throw');
    } finally {
      s.window = saved;
    }
  });

  t.test('nudoWarn is silent unless __NUDO_DEBUG is set', () => {
    let calls = 0;
    const realWarn = s.console.warn;
    s.console.warn = () => { calls++; };
    try {
      s.window.__NUDO_DEBUG = false;
      s.nudoWarn('x', new Error('boom'));
      t.eq(calls, 0, 'nudoWarn must not log in production');
    } finally {
      s.console.warn = realWarn;
      s.window.__NUDO_DEBUG = false;
    }
  });

  t.test('nudoWarn logs when __NUDO_DEBUG is set', () => {
    let calls = 0;
    const realWarn = s.console.warn;
    s.console.warn = () => { calls++; };
    try {
      s.window.__NUDO_DEBUG = true;
      s.nudoWarn('x', new Error('boom'));
      t.eq(calls, 1, 'nudoWarn should log once when debug is on');
    } finally {
      s.console.warn = realWarn;
      s.window.__NUDO_DEBUG = false;
    }
  });

  t.test('nudoWarn never throws, even with a throwing console', () => {
    const realWarn = s.console.warn;
    s.console.warn = () => { throw new Error('console is broken'); };
    try {
      s.window.__NUDO_DEBUG = true;
      s.nudoWarn('x', new Error('boom'));   // must not propagate
      t.ok(true, 'survived a throwing console');
    } finally {
      s.console.warn = realWarn;
      s.window.__NUDO_DEBUG = false;
    }
  });

  t.test('nudoWarn never throws when __NUDO_DEBUG is true but window is gone', () => {
    const saved = s.window;
    s.window = undefined;
    try {
      s.nudoWarn('x', new Error('boom'));
      t.ok(true, 'survived a missing window');
    } finally {
      s.window = saved;
    }
  });

  t.test('nudoDiag fires the toast AT MOST ONCE per scope, even if called repeatedly', () => {
    // A retrying write path would otherwise spam the user on every attempt.
    let toasts = 0;
    const savedToast = s.pushToast;
    s.pushToast = () => { toasts++; };
    try {
      s.nudoDiag('scope-A', new Error('1'));
      s.nudoDiag('scope-A', new Error('2'));
      s.nudoDiag('scope-A', new Error('3'));
      t.eq(toasts, 1, 'expected exactly one toast for repeated calls to one scope');
      // A DIFFERENT scope is a different defect and must still be reported.
      s.nudoDiag('scope-B', new Error('4'));
      t.eq(toasts, 2, 'a distinct scope must still notify');
    } finally {
      s.pushToast = savedToast;
    }
  });

  t.test('nudoDiag never throws when pushToast is undefined', () => {
    // pushToast is defined later in the same scope; load order must not matter.
    const savedToast = s.pushToast;
    s.pushToast = undefined;
    try {
      s.nudoDiag('scope-C', new Error('x'));
      t.ok(true, 'survived a missing pushToast');
    } finally {
      s.pushToast = savedToast;
    }
  });

  // =========================================================================
  // Attribution — the falsified-HR-data guard
  // =========================================================================
  t.test('the attribution FALLBACK in follow-ups is gone', () => {
    // The refactor changed ONLY the follow-up attribution path (resolveCurrentUserName),
    // which previously ended `|| 'Equipo'` — making an unattributed entry
    // indistinguishable from a real record.
    // NOTE: two OTHER `|| 'Equipo'` fallbacks remain at app.html:2034 and :5253
    // (displayName / push name). Those are display-only paths, a separate and
    // lesser concern — this test asserts the follow-up path only, so it stays
    // honest about what was actually fixed.
    t.includes(SRC, '— sin identificar —',
               'expected the explicit unattributed placeholder in the follow-up path');
    t.includes(SRC, "nudoWarn('attribution'",
               'expected a diagnostic when the follow-up name cannot be resolved');
    // And the specific old line must be gone.
    t.ok(SRC.indexOf("return { by: uid || '00000000-0000-0000-0000-000000000000', by_name: name || 'Equipo' };") === -1,
         'the old one-line attribution fallback is still present');
  });

  t.test('the surviving silent catches are intentional ones only', () => {
    // Guard against a lazy fix that replaced EVERY catch with a diagnostic and
    // thereby turned cosmetic failures (vibrate, focus, localStorage) into noise
    // on a staff phone. These exact lines must be left alone.
    for (const keep of [
      "try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}",
      "try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) {}",
      "if (navigator.vibrate) navigator.vibrate(pattern || 8);",
    ]) {
      t.includes(SRC, keep, 'this catch is deliberately silent and must stay that way: ' + keep);
    }
  });

  // =========================================================================
  // The push write must now READ BACK its result
  // =========================================================================
  t.test('the push_subscriptions upsert now inspects its error', () => {
    // An RLS-blocked write does not throw — it returns an error object. Without
    // checking `error`, "saved" and "silently ignored" are indistinguishable.
    t.includes(SRC, "const { error: pushErr } = await supabase.from('push_subscriptions').upsert(");
    t.includes(SRC, "if (pushErr) nudoDiag('push', pushErr);");
  });

  t.test('the surviving silent catches are intentional ones only', () => {
    // Guard against a lazy fix that replaced EVERY catch with a diagnostic and
    // thereby turned cosmetic failures (vibrate, focus, localStorage) into noise
    // on a staff phone. These exact lines must be left alone.
    for (const keep of [
      "try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}",
      "try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) {}",
      "if (navigator.vibrate) navigator.vibrate(pattern || 8);",
    ]) {
      t.includes(SRC, keep, 'this catch is deliberately silent and must stay that way: ' + keep);
    }
  });
};
