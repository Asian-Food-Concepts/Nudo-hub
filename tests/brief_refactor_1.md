=== READ THIS FIRST — BUDGET AND SCOPE ===

`app.html` is 346 KB / 6,634 lines, and nearly ALL of it is inside ONE function
(`initApp`, 257 KB). Reading the whole file will exhaust your budget and you will
NOT finish. You are explicitly FORBIDDEN from reading app.html end-to-end.

There are exactly THREE edits below. Make them and STOP.

Allowed reads ONLY:
  - `sed -n 'A,Bp' app.html` on the line ranges named below
  - `grep -n '<pattern>' app.html`
  - `node tests/harness.js`   (this is your correctness gate — see below)
  - the files under `tests/`

Do NOT read app.html in full. Do NOT rewrite the file. Do NOT reformat, re-indent,
or re-quote anything. Every edit is a NARROW, VERBATIM replacement — if you cannot
match the old text exactly, STOP and report that instead of improvising.

=== YOUR GATE: the test harness ===

`node tests/harness.js` must print `34 passed, 0 failed` and exit 0.

Run it BEFORE you start and AFTER every edit. If a count changes from 34/0, you
have broken something — REVERT your last edit and report it. Do not "fix" the
tests: they are the specification and they currently pass against the shipped code.
If you believe a test is wrong, STOP and report rather than editing it.

=== EDIT 1 — make the silent catch in excerptAround report in dev ===

Context: a bare `catch (_) {}` swallows a malformed RegExp silently. That is the
one place in this function where a failure is invisible.

Find this EXACT text (around line 2795-2799):

      const lit = esc(String(needle)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        safe = safe.replace(new RegExp(lit, 'gi'), '<mark class="guide-mark">$&</mark>');
      } catch (_) {}

Replace it with:

      const lit = esc(String(needle)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        safe = safe.replace(new RegExp(lit, 'gi'), '<mark class="guide-mark">$&</mark>');
      } catch (err) {
        // A malformed pattern must never take the snippet down with it, but it
        // must not vanish either: without the mark the result still renders, so
        // the only symptom would be a missing highlight nobody can explain.
        if (window.__NUDO_DEBUG) console.warn('excerptAround: highlight failed', err);
      }

WHY: `console.warn` alone would ship noise to production staff. Gating on
`window.__NUDO_DEBUG` keeps the diagnostic available on demand (set it in the
console) while keeping the production console clean. The catch still swallows —
deliberately — because a failed highlight is cosmetic and must not break search.

=== EDIT 2 — document the coupled geometry warning near planMonday ===

Context: `planMonday()` returns midnight LOCAL Monday. Its correctness depends on
`setHours(0,0,0,0)` — removing it would make `descansoWeekStart` drift across a
DST/timezone boundary in a way that is invisible until a Sunday-night submission
lands in the wrong week.

Find this EXACT text (around line 2998-3004):

  function planMonday() {
    const now = new Date();
    const d = now.getDay(); // 0=Sun
    const diff = (d === 0 ? -6 : 1 - d);
    const m = new Date(now); m.setDate(now.getDate() + diff); m.setHours(0,0,0,0);
    return m;
  }

Replace it with the SAME code plus a comment block above it:

  // COUPLED GEOMETRY — do not change these lines independently.
  // Consumers: descansoWeekStart() (which adds +7 or +14 days) and the
  // `plan`-prefixed planner helpers. `setHours(0,0,0,0)` is load-bearing: it
  // normalises to LOCAL midnight so the +N-day arithmetic in descansoWeekStart
  // cannot drift across a DST boundary. Tests pin this in
  // tests/descansos.test.js ("week_start uses LOCAL date parts").
  // Same function is re-implemented in Python (scripts/descansos_weekly_email.py
  // -> target_week()); keep the two in lockstep or the form and the Tuesday
  // email will disagree.
  function planMonday() {
    const now = new Date();
    const d = now.getDay(); // 0=Sun
    const diff = (d === 0 ? -6 : 1 - d);
    const m = new Date(now); m.setDate(now.getDate() + diff); m.setHours(0,0,0,0);
    return m;
  }

WHY: this is a pure COMMENT addition — zero behaviour change. Its value is that the
next person to "tidy" `setHours` sees why it is there.

=== EDIT 3 — document the write-guard contract ===

Context: `installWriteGuard()` replaces insert/update/upsert/delete with a fake
promise. A previous version returned a NON-CHAINABLE object, so any handler that
did `.upsert(...).select()` threw `...select is not a function` and surfaced as the
misleading "No se pudo guardar". The chainability is the whole point.

Find this EXACT text (around line 5874-5887):

  function installWriteGuard() {
    if (__writeGuardOn) return;
    const origFrom = supabase.from.bind(supabase);
    supabase.from = function (table) {
      const q = origFrom(table);
      if (!VIEW_AS) return q;
      ['insert', 'update', 'upsert', 'delete'].forEach(m => {
        q[m] = () => Promise.resolve({
          data: null,
          error: { message: 'Modo "Visto como" es de solo lectura. Toca "Salir" para poder editar.' }
        });
      });
      return q;
    };

Replace ONLY the comment ABOVE the function (do not touch the body) — insert this
block immediately before `function installWriteGuard() {`:

  // CONTRACT: the stub returned below must stay CHAINABLE.
  // Handlers throughout the app write `supabase.from(t).upsert(...).select()`.
  // An earlier revision replaced the method with a plain promise, so `.select`
  // did not exist and the call threw "select is not a function" — which the UI
  // reported as the misleading "No se pudo guardar". The returned object is the
  // ONLY thing any view-as write ever sees, so it must answer the same shape the
  // real client does.

WHY: pure comment. It pins the reason the fake promise is shaped that way, which is
otherwise inexplicable to a reader and easy to "simplify" back into the bug.

=== WHAT TO REPORT BACK ===

1. `node tests/harness.js` output — must be `34 passed, 0 failed`.
2. `node --check` on the extracted script block, or state you ran it and it passed.
3. `git status --porcelain` — must show ONLY `M app.html`.
4. Confirm you did NOT commit, did NOT push, and did NOT touch sw.js / version.json.
5. If any anchor did not match EXACTLY once, say which and change nothing.
