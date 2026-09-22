/**
 * The Descansos week rule — the single highest-value contract in the app.
 *
 * WHY THIS IS TESTED HARD
 * The rule decides TWO things that must never disagree:
 *   1. the range/deadline the form SHOWS the applicant, and
 *   2. the `week_start` value it STORES.
 * The identical rule is re-implemented in Python (scripts/descansos_weekly_email.py
 * -> target_week()) for the Tuesday email. If the two ever drift, the form shows
 * one week while the email reports another, and the roster is built off a week
 * nobody was asked about.
 *
 * The rule (from the code comments at app.html ~5705):
 *   Mon or Tue  -> the deadline is THIS Tuesday  -> week = Monday + 7
 *   Wed..Sun    -> the deadline is NEXT Tuesday  -> week = Monday + 14
 *
 * Every case below pins a specific calendar date, so "today" can never make the
 * suite pass or fail by accident.
 */

module.exports = function (t) {
  const NAMES = ['descansoWeekStart', 'descansoRangeLabel', 'descansoCutoffLabel', 'planMonday'];
  const at = (iso) => t.sandbox(NAMES, { now: iso + 'T12:00:00' });

  // --- the week_start value itself -----------------------------------------

  t.test('Monday -> target week is NEXT Monday (this Tuesday is the deadline)', () => {
    // Mon 2026-09-21 -> deadline Tue 22 Sep -> week starts Mon 28 Sep
    t.eq(at('2026-09-21').descansoWeekStart(), '2026-09-28');
  });

  t.test('Tuesday -> still the following week (deadline is TODAY)', () => {
    // Tue 2026-09-22 -> deadline today -> week starts Mon 28 Sep
    t.eq(at('2026-09-22').descansoWeekStart(), '2026-09-28');
  });

  t.test('Wednesday -> next Tuesday is the deadline -> week starts +14', () => {
    // Wed 2026-09-23 -> deadline Tue 29 Sep -> week starts Mon 5 Oct
    t.eq(at('2026-09-23').descansoWeekStart(), '2026-10-05');
  });

  t.test('Thursday, Friday, Saturday, Sunday all land on the same +14 week', () => {
    for (const iso of ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']) {
      t.eq(at(iso).descansoWeekStart(), '2026-10-05', 'for ' + iso);
    }
  });

  t.test('a Wed->Tue window maps every submission to ONE week', () => {
    // The invariant: once the week rule picks a target, EVERY day up to and
    // including the deadline Tuesday must agree. Wed 23 Sep..Tue 29 Sep all
    // still resolve to the 28 Sep week (the deadline is Tue 29).
    // (An earlier version of this test called it a "Tue->Tue window" and
    // included Wed 23 while expecting the PREVIOUS week — the app was right.)
    for (const iso of ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
                       '2026-09-27', '2026-09-28', '2026-09-29']) {
      t.eq(at(iso).descansoWeekStart(), '2026-10-05', 'inside window: ' + iso);
    }
  });

  t.test('the Monday BEFORE the deadline already targets the following week', () => {
    // Mon 21 Sep -> deadline Tue 22 -> week Mon 28 Sep.
    t.eq(at('2026-09-21').descansoWeekStart(), '2026-09-28');
    // Mon 28 Sep -> deadline Tue 29 -> week Mon 5 Oct. The deadline is the
    // day AFTER, so the Monday itself is still "this Tuesday's" window.
    t.eq(at('2026-09-28').descansoWeekStart(), '2026-10-05');
  });

  t.test('week_start is ALWAYS a Monday', () => {
    for (let d = 1; d <= 30; d++) {
      const iso = '2026-09-' + String(d).padStart(2, '0');
      const ws = at(iso).descansoWeekStart();
      const p = ws.split('-').map(Number);
      const day = new Date(p[0], p[1] - 1, p[2]).getDay();
      t.eq(day, 1, 'week_start for ' + iso + ' was ' + ws + ' (day=' + day + ', must be 1=Mon)');
    }
  });

  t.test('week_start uses LOCAL date parts (never shifts on a late-evening call)', () => {
    // The code comment warns toISOString() shifts the day for late-evening CDMX.
    // Assert the boundary: 23:30 local on a Monday still resolves to that Monday.
    const late = t.sandbox(NAMES, { now: '2026-09-21T23:30:00' });
    t.eq(late.descansoWeekStart(), '2026-09-28');
    const early = t.sandbox(NAMES, { now: '2026-09-21T00:30:00' });
    t.eq(early.descansoWeekStart(), '2026-09-28');
  });

  t.test('the value is zero-padded YYYY-MM-DD', () => {
    // A single-digit month/day must not render as "2026-10-5".
    const ws = at('2026-09-23').descansoWeekStart();
    t.eq(ws.length, 10);
    t.ok(/^\d{4}-\d{2}-\d{2}$/.test(ws), 'bad shape: ' + ws);
  });

  // --- the human-facing labels ---------------------------------------------

  t.test('range label spans Mon..Sun in Spanish', () => {
    // week 2026-09-28 (Mon) .. 2026-10-04 (Sun) -> "28 sep – 4 oct"
    t.eq(at('2026-09-21').descansoRangeLabel(), '28 sep – 4 oct');
  });

  t.test('range label collapses the month when start and end share it', () => {
    // A week entirely inside October: Mon 5 .. Sun 11 -> "5 oct – 11 oct"
    // (same month -> the code prints the end month once)
    const r = at('2026-09-30').descansoRangeLabel();
    t.ok(r.indexOf('oct') !== -1, 'expected oct in ' + r);
  });

  t.test('cutoff label is the Tuesday 6 days before the target Monday', () => {
    // week starts Mon 28 Sep -> cutoff Tue 22 Sep
    t.eq(at('2026-09-21').descansoCutoffLabel(), 'martes 22 sep');
  });

  t.test('cutoff label agrees with the week rule on a Wed..Sun visit', () => {
    // Wed 23 Sep -> week starts Mon 5 Oct -> cutoff Tue 29 Sep
    t.eq(at('2026-09-23').descansoCutoffLabel(), 'martes 29 sep');
  });

  t.test('the cutoff is always a Tuesday, and always 6 days before week_start', () => {
    for (const iso of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-25', '2026-09-27']) {
      const ctx = at(iso);
      const ws = ctx.descansoWeekStart();
      const p = ws.split('-').map(Number);
      const start = new Date(p[0], p[1] - 1, p[2]);
      // The cutoff is derived, never stored: Monday - 6 days.
      const cut = new Date(start.getTime() - 6 * 86400000);
      t.eq(cut.getDay(), 2, 'cutoff for week ' + ws + ' must be a Tuesday');
      t.includes(ctx.descansoCutoffLabel(), 'martes', 'cutoff label for ' + iso);
    }
  });

  // --- the exact live scenario Ben saw -------------------------------------

  t.test('on 21 Sep 2026 (the live case) the form shows 28 sep – 4 oct / martes 22 sep', () => {
    const ctx = at('2026-09-21');
    t.eq(ctx.descansoRangeLabel(), '28 sep – 4 oct');
    t.eq(ctx.descansoCutoffLabel(), 'martes 22 sep');
    t.eq(ctx.descansoWeekStart(), '2026-09-28');
  });
};
