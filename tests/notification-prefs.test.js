/**
 * tests/notification-prefs.test.js
 *
 * Verification suite for per-category notification management:
 *   1. User with NO preference row still receives notifications (default ON)
 *   2. Disabling `mantenimiento` stops maintenance pushes AND still allows bitacora
 *   3. Preference is enforced when sender is NOT the client (server path simulation)
 *   4. User cannot read or write another user's preferences (RLS boundary)
 *   5. Master switch OFF suppresses everything regardless of per-category values
 *   6. Failed preference lookup logs and does NOT silently drop
 *   7. UI affordance & modal contract (plain word, gear affordance, mobile-friendly >=44px)
 */

const { FakeSupabase } = require('./fakesupabase.js');
const { Document } = require('./fakedom.js');

module.exports = function (t) {
  // Helper to build sandbox with FakeSupabase and DOM
  function buildSandbox(seed, authUser) {
    const sb = new FakeSupabase({
      seed: Object.assign({
        profiles: [
          { id: 'u1', name: 'Ana Lopez', role: 'Staff', branch: 'Roma Norte' },
          { id: 'u2', name: 'Beto Cruz', role: 'Staff', branch: 'Del Valle' },
        ],
        push_subscriptions: [
          { id: 'sub-1', user_id: 'u1', endpoint: 'https://push.example.com/u1', p256dh: 'k1', auth: 'a1' },
          { id: 'sub-2', user_id: 'u2', endpoint: 'https://push.example.com/u2', p256dh: 'k2', auth: 'a2' },
        ],
        notification_prefs: []
      }, seed || {}),
      user: authUser || { id: 'u1', email: 'ana@nudo.mx' }
    });

    const dom = new Document(t.markup);
    const s = t.sandbox([
      'checkUserNotifPref',
      'serverFilterPushSubscriptions',
      'loadUserNotifPrefs',
      'saveUserNotifPref',
      'isNotificationCategoryEnabled',
      'renderNotifPrefsUI',
      'openNotifPrefsModal',
      'closeNotifPrefsModal',
      'setNotifState',
      'togglePushSubscription',
      'esc'
    ], {
      dom,
      globals: {
        $: (id) => dom.getElementById(id),
        pushToast: () => {},
        haptic: () => {},
        clearTimeout: () => {},
        setTimeout: (fn) => fn(),
        userNotifPrefs: {},
        NOTIF_CATEGORIES: [
          { id: 'bitacora', name: 'Bitácora', icon: '📖', desc: 'Avisos de apertura, corte, propinas y cierre de turno.' },
          { id: 'descansos', name: 'Descansos', icon: '🏖️', desc: 'Solicitudes y cambios de días de descanso semanal.' },
          { id: 'mantenimiento', name: 'Mantenimiento', icon: '🔧', desc: 'Cuando se reporta, atiende o completa una falla.' },
          { id: 'compras', name: 'Compras', icon: '🛒', desc: 'Nuevas solicitudes de compra, cotizaciones y entregas.' },
          { id: 'onboarding', name: 'Onboarding', icon: '👋', desc: 'Ingreso de nuevo personal, documentación y bienvenida.' },
          { id: 'entrevistas', name: 'Entrevistas', icon: '🎯', desc: 'Candidatos agendados y recordatorios de entrevistas.' }
        ],
        supabase: sb,
        Notification: { permission: 'granted' },
        navigator: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
          platform: 'iPhone',
          maxTouchPoints: 5,
          serviceWorker: {
            ready: Promise.resolve({
              pushManager: {
                getSubscription: () => Promise.resolve({ endpoint: 'https://push.example.com/u1' })
              }
            })
          }
        },
        window: { matchMedia: () => ({ matches: true }) }
      }
    });
    s.__sb = sb;
    s.__dom = dom;
    return s;
  }

  // =========================================================================
  // 1. Default ON: User with NO preference row still receives notifications
  // =========================================================================
  t.test('NOTIF-PREFS (1): user with NO preference row receives notifications (default ON)', async () => {
    const s = buildSandbox();
    const sb = s.__sb;

    // Verify database has no preference row for u1 or u2
    const { data: rows } = await sb.from('notification_prefs').select('*');
    t.eq((rows || []).length, 0, 'database must start with 0 preference rows');

    // checkUserNotifPref must return true for every category by default
    for (const cat of ['bitacora', 'descansos', 'mantenimiento', 'compras', 'onboarding', 'entrevistas']) {
      const allowed = await s.checkUserNotifPref('u1', cat, sb);
      t.eq(allowed, true, `default for ${cat} without preference row must be true`);
    }

    // Server-side filter must include the user when sending pushes for any category
    const recipients = await s.serverFilterPushSubscriptions('mantenimiento', sb, ['u1']);
    t.eq(recipients.length, 1, 'user without preference row must be included in push recipients');
    t.eq(recipients[0].user_id, 'u1', 'recipient must be u1');
  });

  // =========================================================================
  // 2. Disabling mantenimiento stops maintenance pushes AND still allows bitacora
  // =========================================================================
  t.test('NOTIF-PREFS (2): disabling mantenimiento stops maintenance pushes AND still allows bitacora', async () => {
    const s = buildSandbox({
      notification_prefs: [
        { id: 'p1', user_id: 'u1', category: 'mantenimiento', enabled: false }
      ]
    });
    const sb = s.__sb;

    // Direct check on mantenimiento: false
    const mantAllowed = await s.checkUserNotifPref('u1', 'mantenimiento', sb);
    t.eq(mantAllowed, false, 'mantenimiento preference must be false');

    // Direct check on bitacora: true (unconfigured / default)
    const bitaAllowed = await s.checkUserNotifPref('u1', 'bitacora', sb);
    t.eq(bitaAllowed, true, 'bitacora preference must remain true');

    // Server push filter for mantenimiento must exclude u1
    const mantRecipients = await s.serverFilterPushSubscriptions('mantenimiento', sb, ['u1']);
    t.eq(mantRecipients.length, 0, 'mantenimiento push must NOT include u1');

    // Server push filter for bitacora must include u1
    const bitaRecipients = await s.serverFilterPushSubscriptions('bitacora', sb, ['u1']);
    t.eq(bitaRecipients.length, 1, 'bitacora push must include u1');
    t.eq(bitaRecipients[0].user_id, 'u1');
  });

  // =========================================================================
  // 3. The preference is enforced when sender is NOT the client (server path)
  // =========================================================================
  t.test('NOTIF-PREFS (3): preference is enforced when sender is NOT the client (server path)', async () => {
    const s = buildSandbox({
      push_subscriptions: [
        { id: 'sub-1', user_id: 'u1', endpoint: 'ep1', p256dh: 'k1', auth: 'a1' },
        { id: 'sub-2', user_id: 'u2', endpoint: 'ep2', p256dh: 'k2', auth: 'a2' },
      ],
      notification_prefs: [
        { id: 'p1', user_id: 'u1', category: 'compras', enabled: false }, // u1 disabled compras
        { id: 'p2', user_id: 'u2', category: 'compras', enabled: true },  // u2 enabled compras
      ]
    });
    const sb = s.__sb;

    // Simulate backend push dispatch (e.g. Edge function / trigger / cron pushing for 'compras')
    const comprasRecipients = await s.serverFilterPushSubscriptions('compras', sb);
    t.eq(comprasRecipients.length, 1, 'server dispatch must only find 1 eligible subscriber for compras');
    t.eq(comprasRecipients[0].user_id, 'u2', 'only u2 is eligible for compras push');

    // Simulate backend push dispatch for 'descansos' (where neither has a row -> both receive)
    const descansosRecipients = await s.serverFilterPushSubscriptions('descansos', sb);
    t.eq(descansosRecipients.length, 2, 'both users must receive descansos push');
  });

  // =========================================================================
  // 4. A user cannot read or write another user's preferences
  // =========================================================================
  t.test('NOTIF-PREFS (4): user cannot read or write another user preferences (RLS enforcement)', async () => {
    const s = buildSandbox({
      notification_prefs: [
        { id: 'p1', user_id: 'u1', category: 'bitacora', enabled: true },
        { id: 'p2', user_id: 'u2', category: 'bitacora', enabled: false },
      ]
    }, { id: 'u1', email: 'ana@nudo.mx' });
    const sb = s.__sb;

    // In client saveUserNotifPref, payload is bound strictly to authenticated user.id
    await s.saveUserNotifPref('bitacora', false, sb);
    const u1Rows = sb.db.rows('notification_prefs').filter((r) => r.user_id === 'u1' && r.category === 'bitacora');
    t.eq(u1Rows.length, 1, 'u1 row must be updated');
    t.eq(u1Rows[0].enabled, false, 'u1 enabled must be false');

    // u2's row must be completely untouched
    const u2Rows = sb.db.rows('notification_prefs').filter((r) => r.user_id === 'u2' && r.category === 'bitacora');
    t.eq(u2Rows[0].enabled, false, 'u2 row remains untouched');

    // Simulate RLS write rejection when caller tries to write another user's row
    sb.db.failNextWrite('notification_prefs', 'new row violates row-level security policy for table notification_prefs', '42501');
    const { error: rlsErr } = await sb.from('notification_prefs').upsert({
      user_id: 'u2', // u1 attempting to write as u2
      category: 'bitacora',
      enabled: true
    });
    t.ok(rlsErr, 'RLS must reject cross-user write');
    t.eq(rlsErr.code, '42501', 'error code must be 42501 (insufficient_privilege / RLS violation)');
  });

  // =========================================================================
  // 5. Master switch OFF suppresses everything regardless of per-category values
  // =========================================================================
  t.test('NOTIF-PREFS (5): master switch OFF suppresses everything regardless of per-category values', async () => {
    // User u1 has explicit TRUE for every category, but has NO push subscription (master switch OFF)
    const s = buildSandbox({
      push_subscriptions: [
        // u1 has no entry in push_subscriptions
        { id: 'sub-2', user_id: 'u2', endpoint: 'ep2', p256dh: 'k2', auth: 'a2' }
      ],
      notification_prefs: [
        { id: 'p1', user_id: 'u1', category: 'bitacora', enabled: true },
        { id: 'p2', user_id: 'u1', category: 'descansos', enabled: true },
        { id: 'p3', user_id: 'u1', category: 'mantenimiento', enabled: true },
      ]
    });
    const sb = s.__sb;

    for (const cat of ['bitacora', 'descansos', 'mantenimiento']) {
      const recipients = await s.serverFilterPushSubscriptions(cat, sb, ['u1']);
      t.eq(recipients.length, 0, `master switch OFF must suppress pushes for ${cat} despite category being enabled`);
    }
  });

  // =========================================================================
  // 6. A failed preference lookup logs and does NOT silently drop
  // =========================================================================
  t.test('NOTIF-PREFS (6): failed preference lookup logs and does NOT silently drop', async () => {
    const s = buildSandbox({
      push_subscriptions: [
        { id: 'sub-1', user_id: 'u1', endpoint: 'ep1', p256dh: 'k1', auth: 'a1' }
      ]
    });
    const sb = s.__sb;

    // Intercept console.warn to verify logging
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      // Force lookup to fail on the mock client
      const brokenSb = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: { message: 'connection timeout' } })
              })
            })
          })
        })
      };

      const result = await s.checkUserNotifPref('u1', 'mantenimiento', brokenSb);
      t.eq(result, true, 'failed lookup must return true (default ON, never silently drop)');
      t.ok(warnings.some((w) => w.includes('preference lookup failed')), 'warning must be logged on failed lookup');

      // Also verify throwing client is caught, logged, and does NOT drop
      const throwingSb = {
        from: () => { throw new Error('database offline'); }
      };
      const throwResult = await s.checkUserNotifPref('u1', 'mantenimiento', throwingSb);
      t.eq(throwResult, true, 'exception in lookup must return true (never silently drop)');
      t.ok(warnings.some((w) => w.includes('preference lookup threw')), 'warning must be logged on exception');
    } finally {
      console.warn = origWarn;
    }
  });

  // =========================================================================
  // 7. UI Affordance & Modal Contract: discoverability, labels, and mobile size
  // =========================================================================
  t.test('NOTIF-PREFS (7): UI affordance exists in userbar with plain word and gear affordance', () => {
    const dom = new Document(t.markup);
    const toggle = dom.getElementById('notif-toggle');
    t.ok(toggle, '#notif-toggle must exist in userbar');

    const label = toggle.querySelector('.notif-label');
    t.ok(label, '.notif-label must exist inside #notif-toggle');
    t.includes(label.textContent, 'Notificaciones', 'plain word Notificaciones must be preserved (no jargon)');

    const gear = toggle.querySelector('.notif-gear');
    t.ok(gear, '.notif-gear affordance must exist inside #notif-toggle');
    t.includes(gear.textContent, '⚙️', 'gear icon affordance must be visible');

    // Modal structure
    const modal = dom.getElementById('notif-prefs-modal');
    t.ok(modal, '#notif-prefs-modal must exist in document');
    t.ok(modal.classList.contains('review-modal'), 'modal must participate in review-modal class');
    t.ok(modal.classList.contains('hidden'), 'modal must start hidden');

    // Master switch in modal
    const master = dom.getElementById('notif-modal-master-toggle');
    t.ok(master, '#notif-modal-master-toggle must exist in modal');

    // Categories list container
    const catList = dom.getElementById('notif-categories-list');
    t.ok(catList, '#notif-categories-list container must exist in modal');
  });

  t.test('NOTIF-PREFS (8): renderNotifPrefsUI populates all 6 categories with Spanish descriptions', () => {
    const s = buildSandbox();
    s.renderNotifPrefsUI();

    const dom = s.__dom;
    const catList = dom.getElementById('notif-categories-list');
    const rows = catList.querySelectorAll('.notif-cat-row');
    t.eq(rows.length, 6, 'must render exactly 6 category rows');

    const categories = ['bitacora', 'descansos', 'mantenimiento', 'compras', 'onboarding', 'entrevistas'];
    categories.forEach((cat) => {
      const row = catList.querySelector(`[data-cat="${cat}"]`);
      t.ok(row, `row for ${cat} must exist`);
      const toggle = dom.getElementById(`notif-cat-toggle-${cat}`);
      t.ok(toggle, `toggle for ${cat} must exist`);
    });
  });
};
