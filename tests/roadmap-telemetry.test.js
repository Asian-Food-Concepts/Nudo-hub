/**
 * Roadmap telemetry and refinement UI tests — pins the behavior requested by Ben:
 * 1. formatTokens: formats token counts or returns 'sin datos de tokens'. Never returns '0' or '0 tokens'.
 * 2. formatRunTime: formats seconds into s, m s, or h m s.
 * 3. formatRoadmapTelemetry: aggregates runs across attempts (e.g. "2 intentos · 27m 14s · 3.1M tokens").
 *    When all tokens are NULL or missing, displays "sin datos de tokens" and NEVER "0".
 * 4. renderRoadmap DOM output:
 *    - renders compact telemetry in both desktop and mobile views for rows with runs.
 *    - an attempt with NULL tokens renders 'sin datos de tokens' and NOT '0'.
 *    - refinement box ("Pedir refinamiento") renders ONLY on 'done' rows, and is omitted on 'queued', 'building', 'suggested', and 'failed' rows.
 * 5. requestRoadmapRefinement:
 *    - double-submit guard: disables the button while the write is in flight.
 *    - sets row status to 'queued' and writes text to 'ben_comment'.
 *    - leaves result_note and result_ref untouched.
 */

const { Document } = require('./fakedom.js');

module.exports = function (t) {
  const s = t.sandbox(['formatTokens', 'formatRunTime', 'formatRoadmapTelemetry', 'esc']);
  const formatTokens = s.formatTokens;
  const formatRunTime = s.formatRunTime;
  const formatRoadmapTelemetry = s.formatRoadmapTelemetry;

  // =========================================================================
  // 1. formatTokens — null vs 0 is load-bearing
  // =========================================================================
  t.test('formatTokens: null/undefined/0/negative return "sin datos de tokens"', () => {
    t.eq(formatTokens(null), 'sin datos de tokens');
    t.eq(formatTokens(undefined), 'sin datos de tokens');
    t.eq(formatTokens(0), 'sin datos de tokens');
    t.eq(formatTokens('0'), 'sin datos de tokens');
    t.eq(formatTokens(-5), 'sin datos de tokens');
    t.eq(formatTokens(NaN), 'sin datos de tokens');
    t.ok(formatTokens(null) !== '0', 'must not return literal 0');
    t.ok(formatTokens(0) !== '0', '0 tokens must never return 0');
    t.ok(formatTokens(null) !== '0 tokens', 'must never return 0 tokens');
  });

  t.test('formatTokens: formats small, thousand (k) and million (M) tokens correctly', () => {
    t.eq(formatTokens(42), '42 tokens');
    t.eq(formatTokens(999), '999 tokens');
    t.eq(formatTokens(1000), '1k tokens');
    t.eq(formatTokens(1200), '1.2k tokens');
    t.eq(formatTokens(150000), '150k tokens');
    t.eq(formatTokens(1000000), '1M tokens');
    t.eq(formatTokens(3100000), '3.1M tokens');
  });

  // =========================================================================
  // 2. formatRunTime — human readable duration
  // =========================================================================
  t.test('formatRunTime: formats seconds, minutes and hours', () => {
    t.eq(formatRunTime(null), '');
    t.eq(formatRunTime(0), '');
    t.eq(formatRunTime(45), '45s');
    t.eq(formatRunTime(120), '2m 0s');
    t.eq(formatRunTime(1634), '27m 14s');
    t.eq(formatRunTime(3665), '1h 1m 5s');
  });

  // =========================================================================
  // 3. formatRoadmapTelemetry — aggregate line across attempts
  // =========================================================================
  t.test('formatRoadmapTelemetry: empty or missing runs return empty string', () => {
    t.eq(formatRoadmapTelemetry([]), '');
    t.eq(formatRoadmapTelemetry(null), '');
  });

  t.test('formatRoadmapTelemetry: single run shows time and tokens without attempt count', () => {
    const runs = [{ attempt: 1, elapsed_secs: 120, tokens: 50000 }];
    const str = formatRoadmapTelemetry(runs);
    t.eq(str, '2m 0s · 50k tokens');
    t.ok(!str.includes('intento'), 'single run should not prefix attempt count');
  });

  t.test('formatRoadmapTelemetry: multiple runs show attempt count, total time and total tokens', () => {
    const runs = [
      { attempt: 1, elapsed_secs: 1000, tokens: 1500000 },
      { attempt: 2, elapsed_secs: 634, tokens: 1600000 },
    ];
    const str = formatRoadmapTelemetry(runs);
    t.eq(str, '2 intentos · 27m 14s · 3.1M tokens');
  });

  t.test('formatRoadmapTelemetry: null tokens output "sin datos de tokens" and NEVER "0"', () => {
    const runs = [
      { attempt: 1, elapsed_secs: 1324, tokens: null },
      { attempt: 2, elapsed_secs: 1248, tokens: null },
    ];
    const str = formatRoadmapTelemetry(runs);
    t.ok(str.includes('2 intentos'), 'shows 2 intentos');
    t.ok(str.includes('42m 52s'), 'sums elapsed time');
    t.ok(str.includes('sin datos de tokens'), 'displays sin datos de tokens');
    t.ok(!str.includes(' 0 tokens'), 'must never include 0 tokens');
    t.ok(!str.includes('· 0 ·'), 'must never include literal 0');
  });

  // =========================================================================
  // 4. renderRoadmap DOM output — telemetry & refinement control
  // =========================================================================
  const ROADMAP_STATUSES = {
    suggested:   { label: 'Sugerido',    ico: '💡', bg: 'rgba(26,86,219,0.1)',   color: '#1a56db' },
    queued:      { label: 'En cola',     ico: '⏳', bg: 'rgba(176,96,0,0.12)',   color: '#b06000' },
    building:    { label: 'Construyendo', ico: '🚀', bg: 'rgba(118,39,187,0.12)', color: '#7627bb' },
    done:        { label: 'Hecho',       ico: '✅', bg: 'rgba(31,122,77,0.12)',  color: '#1f7a4d' },
    failed:      { label: 'Falló',       ico: '❌', bg: 'rgba(198,40,40,0.12)',  color: '#c62828' }
  };

  function createRoadmapSandbox() {
    const dom = new Document('<div id="roadmap-list"></div><div id="roadmap-msg"></div>');
    const box = t.sandbox(['renderRoadmap', 'esc', 'formatTokens', 'formatRunTime', 'formatRoadmapTelemetry'], {
      dom,
      globals: {
        $: (id) => dom.getElementById(id),
        ROADMAP_STATUSES,
        isOwner: () => true,
        currentProfile: { role: 'Dueño', level: 1, active: true },
        window: {
          __roadmap_open_ids: new Set(['item-done']),
          __roadmap_runs_cache: {}
        },
        onDragPointerDown: () => {},
        onReorderBtnClick: () => {},
        onRowKeyDown: () => {},
        openRoadmapEditModal: () => {},
        requestRoadmapRefinement: () => {},
        approveRoadmapItem: () => {},
        deleteRoadmapItem: () => {},
        moveRoadmapRow: () => {},
        saveRoadmapRow: () => {}
      }
    });
    return { dom, box };
  }

  t.test('renderRoadmap: renders compact telemetry line for rows with runs', () => {
    const { dom, box } = createRoadmapSandbox();
    const rows = [
      {
        id: 'item-done',
        dedupe_key: 'item-done-key',
        title: 'Barra Admin',
        status: 'done',
        _runs: [
          { attempt: 1, elapsed_secs: 1000, tokens: 1500000, outcome: 'failed' },
          { attempt: 2, elapsed_secs: 634, tokens: 1600000, outcome: 'done' }
        ]
      }
    ];
    box.renderRoadmap(rows);
    const listHtml = dom.getElementById('roadmap-list').innerHTML;
    t.ok(listHtml.includes('class="roadmap-telemetry"'), 'telemetry container must be rendered');
    t.ok(listHtml.includes('2 intentos · 27m 14s · 3.1M tokens'), 'telemetry text must match');
  });

  t.test('renderRoadmap: a NULL-token attempt renders "sin datos de tokens" and NOT "0"', () => {
    const { dom, box } = createRoadmapSandbox();
    const rows = [
      {
        id: 'item-done',
        dedupe_key: 'item-backfilled',
        title: 'Histórico',
        status: 'done',
        _runs: [
          { attempt: 1, elapsed_secs: 1324, tokens: null, outcome: 'infra' }
        ]
      }
    ];
    box.renderRoadmap(rows);
    const listHtml = dom.getElementById('roadmap-list').innerHTML;
    t.ok(listHtml.includes('sin datos de tokens'), 'run row must show "sin datos de tokens"');
    t.ok(!listHtml.includes(' 0 tokens'), 'must NOT assert 0 tokens');
    t.ok(!listHtml.includes('· 0 ·'), 'must NOT show 0');
  });

  t.test('renderRoadmap: refinement control exists ONLY on done rows', () => {
    const { dom, box } = createRoadmapSandbox();
    const rows = [
      { id: 'i-done', title: 'Completada', status: 'done', _runs: [] },
      { id: 'i-queued', title: 'En cola', status: 'queued', _runs: [] },
      { id: 'i-building', title: 'Construyendo', status: 'building', _runs: [] },
      { id: 'i-suggested', title: 'Sugerida', status: 'suggested', _runs: [] },
      { id: 'i-failed', title: 'Fallida', status: 'failed', _runs: [] },
    ];
    box.window.__roadmap_open_ids = new Set(['i-done', 'i-queued', 'i-building', 'i-suggested', 'i-failed']);
    box.renderRoadmap(rows);
    const listHtml = dom.getElementById('roadmap-list').innerHTML;

    // Must exist on done
    t.ok(listHtml.includes('data-roadmap-refine="i-done"'), 'refine button must exist on done item');
    t.ok(listHtml.includes('Pedir refinamiento'), 'refinement label must appear on done item');

    // Must NOT exist on any other status
    t.ok(!listHtml.includes('data-roadmap-refine="i-queued"'), 'no refine button on queued');
    t.ok(!listHtml.includes('data-roadmap-refine="i-building"'), 'no refine button on building');
    t.ok(!listHtml.includes('data-roadmap-refine="i-suggested"'), 'no refine button on suggested');
    t.ok(!listHtml.includes('data-roadmap-refine="i-failed"'), 'no refine button on failed');
  });

  // =========================================================================
  // 5. requestRoadmapRefinement — submission, guards and field preservation
  // =========================================================================
  t.test('requestRoadmapRefinement: empty text is rejected without updating', async () => {
    let updateCalled = false;
    const fakeSupabase = {
      from: () => ({
        update: () => {
          updateCalled = true;
          return { eq: () => Promise.resolve({ error: null }) };
        }
      })
    };
    const dom = new Document('<div id="roadmap-list"></div><div id="roadmap-msg"></div>');
    let toasted = '';
    const box = t.sandbox(['requestRoadmapRefinement'], {
      dom,
      globals: {
        setTimeout,
        clearTimeout,
        supabase: fakeSupabase,
        $: (id) => dom.getElementById(id),
        toast: (msg) => { toasted = msg; },
        renderRoadmap: () => {},
        // Same wiring gap as the sibling test: the refinement path can reach renderRoadmap,
        // whose code reads ROADMAP_STATUSES. Absent from the sandbox → ReferenceError that
        // masks the assertion actually under test.
        ROADMAP_STATUSES: {
          suggested: { label: 'Sugerido', icon: '💡' },
          queued: { label: 'En cola', icon: '⏳' },
          building: { label: 'Construyendo', icon: '🚀' },
          done: { label: 'Hecho', icon: '✅' },
          failed: { label: 'Falló', icon: '❌' },
        },
        window: { __roadmap_cache: [] }
      }
    });

    const btn = dom.createElement('button');
    await box.requestRoadmapRefinement('item-1', '   ', btn);
    t.eq(updateCalled, false, 'must not call supabase update on empty text');
    t.ok(toasted.length > 0, 'must alert user to enter refinement text');
  });

  t.test('requestRoadmapRefinement: disables button and sets status to queued preserving result_note/ref', async () => {
    let capturedPayload = null;
    let capturedId = null;
    const fakeSupabase = {
      from: (tbl) => {
        t.eq(tbl, 'roadmap', 'must update roadmap table');
        return {
          update: (payload) => {
            capturedPayload = payload;
            return {
              eq: (col, val) => {
                capturedId = val;
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }
    };
    const dom = new Document('<div id="roadmap-list"></div><div id="roadmap-msg"></div>');
    let reRendered = false;
    const initialItem = {
      id: 'task-123',
      title: 'Mi tarea',
      status: 'done',
      ben_comment: null,
      result_note: 'v0.209.30 committed successfully',
      result_ref: 'abc1234'
    };
    const box = t.sandbox(['requestRoadmapRefinement'], {
      dom,
      globals: {
        setTimeout,
        clearTimeout,
        supabase: fakeSupabase,
        $: (id) => dom.getElementById(id),
        toast: () => {},
        renderRoadmap: () => { reRendered = true; },
        // `requestRoadmapRefinement` reaches renderRoadmap on success. That stub is replaced here,
        // but the REAL function's fallback path reads ROADMAP_STATUSES — so the sandbox must
        // expose it or the call throws ReferenceError and the assertion below reads as a product
        // bug. Test wiring, not app behaviour. (Found by the new test phase, 2026-09-26.)
        ROADMAP_STATUSES: {
          suggested: { label: 'Sugerido', icon: '💡' },
          queued: { label: 'En cola', icon: '⏳' },
          building: { label: 'Construyendo', icon: '🚀' },
          done: { label: 'Hecho', icon: '✅' },
          failed: { label: 'Falló', icon: '❌' },
        },
        window: { __roadmap_cache: [initialItem] }
      }
    });

    const btn = dom.createElement('button');
    btn.innerHTML = '<span>🔄 Pedir refinamiento</span>';

    const p = box.requestRoadmapRefinement('task-123', 'Agregar margen inferior de 16px', btn);
    // Double-submit guard check: button should be disabled immediately while in flight
    t.eq(btn.disabled, true, 'button must be disabled immediately while write is in flight');
    await p;

    t.eq(capturedId, 'task-123', 'must update targeted item');
    t.eq(capturedPayload.status, 'queued', 'status must be set back to queued');
    t.eq(capturedPayload.ben_comment, 'Agregar margen inferior de 16px', 'refinement text saved to ben_comment');

    // Cache updated and previous outcome preserved
    t.eq(initialItem.status, 'queued', 'cache status becomes queued');
    t.eq(initialItem.ben_comment, 'Agregar margen inferior de 16px', 'cache ben_comment updated');
    t.eq(initialItem.result_note, 'v0.209.30 committed successfully', 'result_note preserved');
    t.eq(initialItem.result_ref, 'abc1234', 'result_ref preserved');
    t.eq(reRendered, true, 'renderRoadmap must be called to refresh UI');
  });
};
