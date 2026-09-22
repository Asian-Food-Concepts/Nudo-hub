=== READ THIS FIRST — BUDGET AND SCOPE ===

`app.html` is 346 KB / 6,634 lines. Nearly all of it is inside ONE function
(`initApp`, 257 KB). Reading the whole file will exhaust your budget and you will
NOT finish. You are FORBIDDEN from reading app.html end-to-end.

There are exactly FOUR edits below, at named line numbers. Make them and STOP.

Allowed reads ONLY:
  - `sed -n 'A,Bp' app.html` on the ranges named below
  - `grep -n '<pattern>' app.html`
  - `node tests/harness.js`   ← your correctness gate
  - files under `tests/`

Do NOT read app.html in full. Do NOT rewrite the file. Do NOT reformat or re-indent
anything. Every edit is a NARROW, VERBATIM replacement — if you cannot match the old
text EXACTLY once, STOP and report that instead of improvising.

=== YOUR GATE ===

`node tests/harness.js` must print `34 passed, 0 failed` and exit 0.

Run it BEFORE you start and AFTER every edit. Any change from 34/0 means you broke
something — REVERT that edit and report. Do NOT edit or "fix" the tests: they are the
specification and they pass against the shipped code today. If you think a test is
wrong, STOP and report it.

=== BACKGROUND — why these edits ===

The owner's standing order: "make sure that if things fail, i am notified somehow,
need to eliminate chances of things failing silently."

`app.html` has 28 `catch` blocks that swallow their error completely. MOST OF THEM ARE
CORRECT and must stay exactly as they are: `localStorage` throws in private browsing,
`navigator.vibrate` is absent on desktop, `.focus()` throws on some mobile browsers
mid-transition. Silencing those is deliberate and right.

Exactly THREE are genuinely dangerous, because the failure they hide is a REAL defect
that is otherwise invisible forever. Fix only those. Do not touch the others.

=== EDIT 1 — add a shared diagnostics helper (new code, insert once) ===

Context: three separate places need to report a swallowed failure, and they must all
behave the same way: quiet in production, loud on demand.

Find this EXACT text (around line 1590):

  // ---- THEME (light / dark / system) ----
  const THEME_KEY = 'nudo_theme';

Insert the following block IMMEDIATELY BEFORE it:

  // ---- DIAGNOSTICS ----
  // Several catch blocks below deliberately swallow their error: localStorage
  // throws in private browsing, vibrate() is absent on desktop, focus() throws
  // on some mobile browsers. Silencing THOSE is correct — a cosmetic failure
  // must not take down the action the user asked for.
  //
  // The danger is a catch that hides a REAL defect: the write never lands, the
  // name resolves to a placeholder, and nothing anywhere says so. The owner's
  // standing order is that failures must be announced. These helpers keep a
  // genuinely fatal error visible without turning every cosmetic miss into noise
  // on a staff phone.
  //
  //   nudoWarn(scope, err)  — dev-only console warning (set window.__NUDO_DEBUG)
  //   nudoDiag(scope, err)  — dev-only warning AND a one-time toast, for cases
  //                           where a wrong value is stored rather than merely
  //                           displayed (a silent data defect the user must know
  //                           about because the fix is on them).
  const nudoDebug = () => {
    try { return !!window.__NUDO_DEBUG; } catch (e) { return false; }
  };
  function nudoWarn(scope, err) {
    if (!nudoDebug()) return;
    try { console.warn('[nudo:' + scope + ']', err); } catch (e) {}
  }
  let __nudoDiagOnce = {};
  function nudoDiag(scope, err) {
    nudoWarn(scope, err);
    if (__nudoDiagOnce[scope]) return;   // once per page load, never on every retry
    __nudoDiagOnce[scope] = true;
    try {
      // pushToast is defined later in this same scope; guard the call so a load
      // order change can never turn a diagnostic into a new failure.
      if (typeof pushToast === 'function') {
        pushToast('Aviso interno: algo no se guardó (' + scope + '). Avísale a Ben.', true);
      }
    } catch (e) {}
  }

=== EDIT 2 — push subscription write fails SILENTLY today (a confirmed defect) ===

Context: this upsert registers the device for push notifications. Its failure is
swallowed, so a device that never registers looks identical to a healthy one — the
staffer simply never receives a notification and nobody can tell why.

Find this EXACT text (around lines 5383-5399):

    // Non-fatal: the subscription is still valid locally even if this write fails.
    try {
      if (sub && Notification.permission === 'granted') {
        const j = (typeof sub.toJSON === 'function') ? sub.toJSON() : null;
        const p256dh = (j && j.keys && j.keys.p256dh) || '';
        const auth = (j && j.keys && j.keys.auth) || '';
        if (p256dh && auth) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from('push_subscriptions').upsert(
              { user_id: user.id, endpoint: sub.endpoint, p256dh: p256dh, auth: auth },
              { onConflict: 'endpoint' }
            );
          }
        }
      }
    } catch (_) {}

Replace it with:

    // The local subscription stays valid even if this write fails, so the catch
    // must NOT be fatal — but it must not be silent either: a device that never
    // registers looks exactly like a healthy one, and the only symptom is a
    // notification that never arrives. Read the result back and say so.
    try {
      if (sub && Notification.permission === 'granted') {
        const j = (typeof sub.toJSON === 'function') ? sub.toJSON() : null;
        const p256dh = (j && j.keys && j.keys.p256dh) || '';
        const auth = (j && j.keys && j.keys.auth) || '';
        if (p256dh && auth) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { error: pushErr } = await supabase.from('push_subscriptions').upsert(
              { user_id: user.id, endpoint: sub.endpoint, p256dh: p256dh, auth: auth },
              { onConflict: 'endpoint' }
            );
            // An RLS-blocked write does not throw — it returns an error object,
            // or silently filters the row. Checking `error` is the only way to
            // distinguish "saved" from "ignored".
            if (pushErr) nudoDiag('push', pushErr);
          }
        }
      }
    } catch (err) { nudoDiag('push', err); }

=== EDIT 3 — attribution falls back to a zero-UUID silently ===

Context: a maintenance follow-up is stamped with the author. If the profile lookup
fails, the code silently attributes the entry to `Equipo` and the all-zero UUID —
which is falsified HR data, and it is invisible because the fallback looks valid.

Find this EXACT text (around lines 3825-3839):

    const resolveCurrentUserName = async () => {
      let name = (currentProfile && currentProfile.name) || '';
      let uid = (currentProfile && currentProfile.id) || null;
      if (!name || !uid) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            uid = uid || user.id;
            const { data: p } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
            name = (p && p.name) || user.email || 'Equipo';
          }
        } catch (_) {}
      }
      return { by: uid || '00000000-0000-0000-0000-000000000000', by_name: name || 'Equipo' };
    };

Replace it with:

    const resolveCurrentUserName = async () => {
      let name = (currentProfile && currentProfile.name) || '';
      let uid = (currentProfile && currentProfile.id) || null;
      if (!name || !uid) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            uid = uid || user.id;
            const { data: p } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
            name = (p && p.name) || user.email || '';
          }
        } catch (err) { nudoWarn('attribution', err); }
      }
      // Attribution must never be invented. An entry recorded against the
      // all-zero UUID with the name "Equipo" is indistinguishable from a real
      // record, so it silently corrupts the audit trail. Fall back to the email
      // (a real identifier), and if there is genuinely nothing, say so — the
      // caller renders this string, so the gap is visible on screen instead of
      // being papered over.
      if (!name) {
        nudoWarn('attribution', 'no name resolvable — entry will read as unattributed');
      }
      return {
        by: uid || '00000000-0000-0000-0000-000000000000',
        by_name: name || '— sin identificar —'
      };
    };

=== EDIT 4 — excerptAround's highlight failure becomes observable ===

Find this EXACT text (around lines 2795-2798):

      const lit = esc(String(needle)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        safe = safe.replace(new RegExp(lit, 'gi'), '<mark class="guide-mark">$&</mark>');
      } catch (_) {}

Replace it with:

      const lit = esc(String(needle)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        safe = safe.replace(new RegExp(lit, 'gi'), '<mark class="guide-mark">$&</mark>');
      } catch (err) {
        // Must not be fatal — the snippet still renders without the mark — but a
        // permanently missing highlight is otherwise unexplainable, so report it
        // in dev. nudoWarn is defined in the diagnostics block.
        nudoWarn('search-highlight', err);
      }

=== WHAT TO REPORT BACK ===

1. `node tests/harness.js` output — must be exactly `34 passed, 0 failed`.
2. `node --check` on the extracted app.html script block (extract it first, then check).
3. `git status --porcelain` — must show ONLY `M app.html`.
4. Confirm you did NOT commit, did NOT push, and did NOT touch sw.js or version.json.
5. For EACH of the 4 anchors: state the exact occurrence count you found before replacing.
   If any was not exactly 1, stop and change nothing.
