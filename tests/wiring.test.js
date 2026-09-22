/**
 * Guard against the diagnostics being REMOVED.
 *
 * WHY THIS FILE EXISTS — a proven blind spot.
 * Mutation testing found that deleting `nudoWarn('search-highlight', err)` from
 * excerptAround left all 59 tests GREEN. The suite asserted that the helpers
 * exist and that the helpers behave, but nothing asserted they were actually
 * WIRED to the three danger sites. A refactor that silently reverted the fix
 * would have passed CI and shipped.
 *
 * These tests assert the CONNECTION, not just the parts. Each was verified to
 * FAIL against the un-wired file before being kept.
 */

module.exports = function (t) {
  const SRC = t.src;

  /** The body of a named function, or '' if absent. */
  const bodyOf = (name) => t.extractFunction(name) || '';

  t.test('WIRING: excerptAround reports its highlight failure', () => {
    const body = bodyOf('excerptAround');
    t.ok(body.length > 0, 'excerptAround not found');
    // The catch must name the helper AND pass the error through.
    t.includes(body, 'nudoWarn(', 'excerptAround must report the swallowed highlight error');
    // A bare `catch (_) {}` here is the exact regression this guards.
    t.ok(!/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(body),
         'excerptAround still swallows silently with `catch (_) {}`');
  });

  t.test('WIRING: the push subscription write reports its failure', () => {
    // The gap between the two statements contains a 4-line explainer comment, so
    // the window must be generous. (A 400-char cap failed against the real file,
    // which is a wrong TEST, not a missing fix — the wiring was present.)
    const m = SRC.match(/const \{ error: pushErr \}[\s\S]{0,800}?if \(pushErr\) nudoDiag\('push', pushErr\);/);
    t.ok(m, 'the push upsert must capture its error and report it via nudoDiag');
    // And the outer catch must not be a silent swallow.
    t.ok(!/await supabase\.from\('push_subscriptions'\)\.upsert\([\s\S]{0,500}?catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(SRC),
         'the push write is still wrapped in a silent catch');
  });

  t.test('WIRING: attribution reports when it cannot resolve a name', () => {
    const body = bodyOf('resolveCurrentUserName');
    t.ok(body.length > 0, 'resolveCurrentUserName not found (it is a const arrow)');
    t.includes(body, "nudoWarn('attribution'", 'attribution must warn when the name is unresolvable');
    // The old silent swallow must be gone.
    t.ok(!/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(body),
         'the attribution catch is still a silent swallow');
    t.ok(body.indexOf("|| 'Equipo'") === -1,
         'attribution still falls back to the literal "Equipo"');
  });

  t.test('WIRING: each danger site reports under a DISTINCT scope', () => {
    // Distinct scopes are what make the once-per-load toast useful: collapsing
    // two different defects onto one scope would suppress the second report.
    const scopes = new Set();
    for (const m of SRC.matchAll(/nudo(?:Warn|Diag)\('([^']+)'/g)) scopes.add(m[1]);
    for (const want of ['search-highlight', 'push', 'attribution']) {
      t.ok(scopes.has(want), 'no diagnostic is wired under the scope "' + want + '"');
    }
  });

  t.test('WIRING: three previously-silent sites now report', () => {
    // MEASURED, not assumed. Empty catches: 28 BEFORE the refactor, 27 AFTER.
    // Net -1 is CORRECT and the arithmetic matters:
    //   -3  the three danger sites (excerptAround, attribution, push) now report
    //   +2  the diagnostics block itself adds its own never-throw guards
    //       (nudoWarn's console.warn, and nudoDiag's pushToast call)
    // A naive "-3 means 25" expectation was wrong and produced a false failure.
    // The meaningful assertion is not the total but the CONVERSION: each danger
    // site must have stopped being silent, checked individually below.
    const silent = (SRC.match(/catch[^)]*\)\s*\{\s*\}/g) || []).length;
    t.ok(silent <= 28, 'silent catch count rose to ' + silent + ' (was 28)');
    // The ratchet direction that matters: it must not have GROWN.
    t.ok(silent <= 27, 'silent catches grew past the post-refactor baseline of 27');
  });

  t.test('WIRING: each danger site is individually verified non-silent', () => {
    // Individual checks, so a future edit that re-silences ONE site fails here
    // even if the total happens to stay inside the ratchet above.
    const excerpt = bodyOf('excerptAround');
    t.ok(!/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(excerpt), 'excerptAround re-silenced');

    const attrib = bodyOf('resolveCurrentUserName');
    t.ok(!/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(attrib), 'attribution re-silenced');

    // The push site is nested, so assert on the wiring strings directly.
    t.includes(SRC, "if (pushErr) nudoDiag('push', pushErr);",
               'the push upsert no longer reports its error');
    t.includes(SRC, '} catch (err) { nudoDiag(\'push\', err); }',
               'the push catch is no longer wired to nudoDiag');
  });
};
