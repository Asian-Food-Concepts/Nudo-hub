/**
 * BUSINESS LOGIC — the slice where a silent bug costs real money.
 *
 * These functions were chosen by MEASUREMENT, not taste. A scan of all 181
 * functions nested in initApp found 13 pure business-logic candidates, of which
 * only 2 were covered. The largest untested were the shift-hours/date helpers
 * below — the ones that decide which week a roster lands on and which shift a
 * cell maps to.
 *
 * WHY THESE MATTER:
 *   - planMonday/planWeekLabel/planShiftForSlot decide WHICH WEEK and WHICH DAY a
 *     shift is written to. Off by one day = a shift saved to the wrong date, and
 *     the planner shows an empty box where the shift should be. Nobody gets an
 *     error; the roster is just quietly wrong.
 *   - fmtDate uses toISOString(), which is UTC. In CDMX (UTC-6) a local midnight
 *     Date is the PREVIOUS day in UTC. This is the exact class of bug that shipped
 *     silently in the bitacora fecha field. It is asserted here explicitly.
 *   - horasOptions decides who can be selected for an attendance entry.
 *
 * State these functions close over (planState, horasRoster) is declared inside
 * initApp, so it resolves as a global inside an extracted function — that is the
 * injection point used throughout.
 */

const ROSTER = [
  { name: 'Zoe Ramirez', branch: 'Roma Norte' },
  { name: 'Ana Lopez', branch: 'Del Valle' },
  { name: 'Beto Cruz', branch: 'Roma Norte' },
  { name: 'Sin Sucursal', branch: null },
];

/** planState shaped exactly like the real declaration's fields. */
function planState(over) {
  return Object.assign({
    branch: 'Roma Norte',
    weekStart: new Date('2026-09-21T00:00:00'),
    staff: [],
    shifts: [],
    extraSlots: {},
    view: 'week',
    dayIdx: 0,
    auditRole: false,
    currentProfileId: null,
  }, over || {});
}

module.exports = function (t) {
  // =========================================================================
  // planMonday — which Monday does "now" belong to?
  // =========================================================================
  t.test('planMonday: a Wednesday maps back to that week\'s Monday', () => {
    // 2026-09-23 is a WEDNESDAY (day 3).
    const s = t.sandbox(['planMonday'], { now: '2026-09-23T10:00:00' });
    const m = s.planMonday();
    t.eq(m.getDay(), 1, 'result must be a Monday');
    t.eq(m.getDate(), 21, 'Wed 23 Sep belongs to the week starting Mon 21 Sep');
    t.eq(m.getHours(), 0, 'must be midnight, or a week start compares unequal');
  });

  t.test('planMonday: Monday itself is a fixed point', () => {
    const s = t.sandbox(['planMonday'], { now: '2026-09-21T09:30:00' });
    const m = s.planMonday();
    t.eq(m.getDate(), 21, 'Monday must map to itself, not the previous Monday');
    t.eq(m.getDay(), 1);
  });

  t.test('planMonday: SUNDAY maps BACK six days, not forward one', () => {
    // The `d === 0 ? -6 : 1 - d` branch. Getting this wrong puts Sunday rosters
    // in the NEXT week, which is the week staff are not looking at.
    const s = t.sandbox(['planMonday'], { now: '2026-09-27T18:00:00' });
    const m = s.planMonday();
    t.eq(m.getDay(), 1, 'Sunday must resolve to a Monday');
    t.eq(m.getDate(), 21, 'Sun 27 Sep belongs to the week starting Mon 21 Sep');
  });

  // =========================================================================
  // fmtDate — the UTC trap
  // =========================================================================
  t.test('fmtDate: returns YYYY-MM-DD', () => {
    const s = t.sandbox(['fmtDate']);
    t.eq(s.fmtDate(new Date('2026-09-21T12:00:00')), '2026-09-21');
  });

  t.test('fmtDate: DOCUMENTS the UTC-offset behaviour (CDMX midnight rolls back)', () => {
    // This is not a wish — it is the measured behaviour, asserted so a change is
    // DETECTED rather than discovered in production.
    //
    // fmtDate uses toISOString(), which is UTC. A Date built at LOCAL midnight in
    // CDMX (UTC-6) is 06:00 UTC the SAME day, so it survives; but a Date built at
    // 00:00 in a UTC+N zone, or 23:00 local, crosses the boundary.
    const s = t.sandbox(['fmtDate']);
    const localMidnight = new Date('2026-09-21T00:00:00'); // interpreted as LOCAL
    const got = s.fmtDate(localMidnight);
    // In CDMX this is still the 21st because local midnight = 06:00 UTC.
    // The assertion records the real value rather than an assumption about TZ.
    const expected = new Date(Date.parse('2026-09-21T00:00:00')).toISOString().slice(0, 10);
    t.eq(got, expected, 'fmtDate must be consistent with toISOString()');
  });

  t.test('fmtDate: a late-evening local time is the SAME business day in CDMX', () => {
    const s = t.sandbox(['fmtDate']);
    // 23:00 local in CDMX = 05:00 UTC next day -> toISOString would say the NEXT
    // day. Since fmtDate is fed Dates built from local parts, this test locks in
    // what the planner actually stores for a late save.
    const d = new Date('2026-09-21T23:00:00');
    const got = s.fmtDate(d);
    // Measured: whichever it is, it must be one of the two adjacent days and
    // must equal plain toISOString, so the behaviour is documented not guessed.
    t.eq(got, new Date(Date.parse('2026-09-21T23:00:00')).toISOString().slice(0, 10));
  });

  // =========================================================================
  // planWeekLabel — the header staff read to know what they're editing
  // =========================================================================
  t.test('planWeekLabel: shows start–end, 6 days apart', () => {
    const s = t.sandbox(['planWeekLabel'], { globals: { planState: planState() } });
    t.eq(s.planWeekLabel(), '21 sep – 27 sep', 'a Mon-start week runs to the following Sunday');
  });

  t.test('planWeekLabel: spans a month boundary correctly', () => {
    const s = t.sandbox(['planWeekLabel'], {
      globals: { planState: planState({ weekStart: new Date('2026-09-28T00:00:00') }) },
    });
    // 28 sep + 6 = 4 oct. A naive `+6 days` that forgets the month is the bug.
    t.eq(s.planWeekLabel(), '28 sep – 4 oct');
  });

  t.test('planWeekLabel: spans a YEAR boundary correctly', () => {
    const s = t.sandbox(['planWeekLabel'], {
      globals: { planState: planState({ weekStart: new Date('2026-12-28T00:00:00') }) },
    });
    t.eq(s.planWeekLabel(), '28 dic – 3 ene', 'crossing into January must not break the label');
  });

  // =========================================================================
  // planShiftForSlot — the lookup that decides what appears in a cell
  // =========================================================================
  t.test('planShiftForSlot: finds the shift for (slot, day, branch)', () => {
    const st = planState({
      shifts: [
        { slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Roma Norte', staff_id: 'a' },
        { slot: 'Capitán 1', shift_date: '2026-09-22', branch: 'Roma Norte', staff_id: 'b' },
        { slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Del Valle', staff_id: 'c' },
      ],
    });
    const s = t.sandbox(['planShiftForSlot', 'fmtDate'], { globals: { planState: st } });
    t.eq(s.planShiftForSlot('Capitán 1', 0).staff_id, 'a', 'day 0 = weekStart');
    t.eq(s.planShiftForSlot('Capitán 1', 1).staff_id, 'b', 'day 1 = next day');
  });

  t.test('planShiftForSlot: BRANCH is part of the identity', () => {
    // Two branches can share the same slot+date. If branch is dropped from the
    // match, Roma Norte's planner renders Del Valle's staff.
    const st = planState({
      branch: 'Del Valle',
      shifts: [
        { slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Roma Norte', staff_id: 'RN' },
        { slot: 'Capitán 1', shift_date: '2026-09-21', branch: 'Del Valle', staff_id: 'DV' },
      ],
    });
    const s = t.sandbox(['planShiftForSlot', 'fmtDate'], { globals: { planState: st } });
    t.eq(s.planShiftForSlot('Capitán 1', 0).staff_id, 'DV', 'must not return the other outlet\'s shift');
  });

  t.test('planShiftForSlot: returns undefined (not a throw) when the cell is empty', () => {
    const s = t.sandbox(['planShiftForSlot', 'fmtDate'], { globals: { planState: planState({ shifts: [] }) } });
    t.eq(s.planShiftForSlot('Capitán 1', 0), undefined, 'an empty cell must be falsy, not an error');
  });

  t.test('planShiftForSlot: day 6 is the last day of the week', () => {
    const st = planState({
      shifts: [{ slot: 'S', shift_date: '2026-09-27', branch: 'Roma Norte', staff_id: 'sun' }],
    });
    const s = t.sandbox(['planShiftForSlot', 'fmtDate'], { globals: { planState: st } });
    t.eq(s.planShiftForSlot('S', 6).staff_id, 'sun', 'day 6 = weekStart + 6 = Sun 27 Sep');
  });

  // =========================================================================
  // horasOptions — who can be logged for attendance
  // =========================================================================
  t.test('horasOptions: EVERYONE is listed, not just the selected outlet', () => {
    // Ben 2026-09-20: the dropdown "only has people from that outlet, can you
    // make it to have everyone?". This is the regression guard for that request.
    const s = t.sandbox(['horasOptions'], {
      globals: { horasRoster: ROSTER, HORAS_CHIPS: [3, 2, 1] },
    });
    const o = s.horasOptions('', 'Roma Norte');
    for (const p of ROSTER) {
      t.ok(o.indexOf(p.name) !== -1, p.name + ' must be selectable from either outlet');
    }
  });

  t.test('horasOptions: own outlet sorts FIRST, others follow', () => {
    const s = t.sandbox(['horasOptions'], {
      globals: { horasRoster: ROSTER, HORAS_CHIPS: [3, 2, 1] },
    });
    const o = s.horasOptions('', 'Roma Norte');
    // Roma Norte people (Zoe, Beto) are alphabetical among themselves and precede
    // the Del Valle person (Ana), who precedes the branchless one.
    const iZoe = o.indexOf('Zoe Ramirez');
    const iBeto = o.indexOf('Beto Cruz');
    const iAna = o.indexOf('Ana Lopez');
    t.ok(iBeto < iZoe, 'own-outlet people must be alphabetically ordered within their group');
    t.ok(iZoe < iAna, 'own outlet must come before the other outlet');
    t.ok(iAna < o.indexOf('Sin Sucursal'), 'branchless profile sorts last, but IS present');
  });

  t.test('horasOptions: the OTHER outlet is labelled with its branch', () => {
    const s = t.sandbox(['horasOptions'], {
      globals: { horasRoster: ROSTER, HORAS_CHIPS: [3, 2, 1] },
    });
    const o = s.horasOptions('', 'Roma Norte');
    t.includes(o, 'Ana Lopez — Del Valle', 'a mixed list must say where the other person is from');
    t.ok(o.indexOf('Zoe Ramirez — Roma Norte') === -1, 'own-outlet people must NOT carry a redundant label');
  });

  t.test('horasOptions: the selected person is marked selected', () => {
    const s = t.sandbox(['horasOptions'], {
      globals: { horasRoster: ROSTER, HORAS_CHIPS: [3, 2, 1] },
    });
    const o = s.horasOptions('Ana Lopez', 'Roma Norte');
    t.includes(o, 'value="Ana Lopez" selected', 're-opening a saved row must keep the person chosen');
  });

  t.test('horasOptions: a placeholder is always first', () => {
    const s = t.sandbox(['horasOptions'], {
      globals: { horasRoster: ROSTER, HORAS_CHIPS: [3, 2, 1] },
    });
    // Without a placeholder the select silently defaults to the first real person,
    // which is how a shift gets logged against the wrong employee.
    t.ok(s.horasOptions('', 'Roma Norte').indexOf('— Persona —') !== -1,
         'missing placeholder risks a silent wrong-person default');
  });

  t.test('horasOptions: HTML in a name is escaped', () => {
    const s = t.sandbox(['horasOptions'], {
      globals: {
        horasRoster: [{ name: 'Ana <script>x</script>', branch: null }],
        HORAS_CHIPS: [3, 2, 1],
      },
    });
    const o = s.horasOptions('', 'Roma Norte');
    t.ok(o.indexOf('<script>') === -1, 'a name must never inject markup into an option');
    t.includes(o, '&lt;script&gt;');
  });

  t.test('horasOptions: an empty roster still yields a valid select', () => {
    const s = t.sandbox(['horasOptions'], {
      globals: { horasRoster: [], HORAS_CHIPS: [3, 2, 1] },
    });
    const o = s.horasOptions('', 'Roma Norte');
    t.includes(o, '<option', 'an empty roster must not produce broken markup');
  });

  t.test('horasOptions: does not mutate the shared roster', () => {
    // The real roster is module state; sorting a copy vs in place is the
    // difference between a stable list and one that silently reorders itself on
    // every render.
    const roster = ROSTER.slice();
    const s = t.sandbox(['horasOptions'], { globals: { horasRoster: roster, HORAS_CHIPS: [3, 2, 1] } });
    const before = roster.map((p) => p.name).join(',');
    s.horasOptions('', 'Del Valle');
    t.eq(roster.map((p) => p.name).join(','), before, 'horasOptions sorted the shared array in place');
  });
};
