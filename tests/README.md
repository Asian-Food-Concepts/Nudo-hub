# Nudo Hub — Test Harness

Zero-dependency test suite for `app.html`. Run it with **`node tests/harness.js`**.

## Why this exists

`app.html` was ~6,600 lines / 354 KB with every function nested inside a single
257 KB `initApp()`. There was **no test infrastructure at all**, so a refactor was
unverifiable: you could not tell "I moved code" from "I broke code". This harness
is the safety net that makes refactoring possible.

**Rule: never refactor `app.html` without a green run before AND after.**

```bash
node tests/harness.js            # everything
node tests/harness.js pure       # one file (substring match)
```

Exit code is `0` on green, `1` on any failure — so it can gate a commit.

## How it works

It **reads the shipped `app.html`**, extracts the pure functions it needs by brace
matching, and evaluates them in a `vm` sandbox. It never tests a copy, so a test can
only pass if the code that actually deploys is correct.

- `extractFunction(src, name)` — pulls a named function's full body.
- `extractConst(src, name)` — pulls a single-line module-level `const` (needed for
  `_MESES` / `_DIAS`, which `descansoRangeLabel` depends on). Multi-line initialisers
  are refused rather than truncated — a partial const would evaluate and mislead.
- `sandbox(names, {now})` — loads the named functions plus their transitive
  dependencies (functions **and** referenced constants) into a context with a minimal
  DOM stub. Passing `{now: '2026-09-21T12:00:00'}` freezes the clock so date logic is
  deterministic instead of "whatever day you run it".

## Verified against mutation

A suite that cannot fail proves nothing. Swapping the `+7`/`+14` branches in
`descansoWeekStart` (a one-character-class change) makes **8 tests fail**
(`28 sep – 4 oct` → `5 oct – 11 oct`, `martes 22 sep` → `martes 29 sep`). Clean run:
**34 pass, 0 fail.**

## What is covered

| File | Covers |
|---|---|
| `descansos.test.js` | The week rule (`descansoWeekStart` / `descansoRangeLabel` / `descansoCutoffLabel`) — the highest-value contract, because the SAME rule is re-implemented in Python (`scripts/descansos_weekly_email.py` → `target_week()`) and the two must never drift |
| `pure.test.js` | `normalize` (accent folding), `esc` (HTML escaping), `excerptAround` (search snippets), `urlBase64ToUint8Array` (web-push keys) |

⚠️ **The descansos rule is duplicated in two languages.** If you change it here,
change `descansos_weekly_email.py` in the same commit and re-verify both.

## Adding a test

```js
module.exports = function (t) {
  const ctx = t.sandbox(['myFunction', 'myHelper'], { now: '2026-09-21T12:00:00' });
  t.test('describes the contract, not the current value', () => {
    t.eq(ctx.myFunction('input'), 'expected');
  });
};
```

Rules that keep this useful:
- **Assert contracts, not snapshots.** `week_start is always a Monday` survives a
  refactor; `week_start === '2026-09-28'` for today's date does not.
- **Pin the clock** for anything date-dependent.
- **Test the success path first.** Defects cluster on the case that is supposed to work.
- ⚠️ **When a test fails, classify it before changing code.** Of the first 12 failures
  against the shipped file, **all 12 were errors in the harness or in my own
  expectations — zero were defects in `app.html`** (see `FAILURE-CLASSIFICATION.md`).
  "Fixing" the app to satisfy a bad test is exactly how a careless refactor breaks
  working code.
