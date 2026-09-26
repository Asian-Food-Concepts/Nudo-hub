/**
 * tests/onboarding-profile.test.js
 *
 * Test suite for the onboarding profile activation pipeline:
 *   1. build_short_name('Roberto Yael Peregrina Cruz') === 'Roberto Y. P. C.'
 *   2. a second activation for the same auth_user_id does not create a duplicate row
 *   3. an existing profile's role/branch/level are NOT overwritten by a re-activation
 *   4. the trigger/helper is idempotent under two consecutive calls
 *   5. fail-closed ACCESS layer: role NULL or missing profile treats level as 99
 *   6. invisibility fix: onboarding row stuck > 24 hours with no profile is visible
 *   7. PostgreSQL migration contract: trigger on public.onboarding is idempotent and delegates masking
 */

const fs = require('fs');
const path = require('path');
const { FakeSupabase } = require('./fakesupabase.js');
const { Document } = require('./fakedom.js');

module.exports = function (t) {
  // Sandbox with pure and helper functions
  const dom = new Document(t.markup);
  const s = t.sandbox([
    'build_short_name',
    'activateOnboardingProfile',
    'isOnboardingStalled',
    'isManagement',
    'isOwner',
    'realLevel',
    'mayUseViewAs',
    'esc'
  ], {
    dom,
    globals: {
      $: (id) => dom.getElementById(id),
      VIEW_AS_ENABLED: true,
      currentProfile: null,
      __realProfile: null,
      VIEW_AS: null
    }
  });

  // =========================================================================
  // 1. build_short_name masking rules
  // =========================================================================
  t.test('ONBOARDING-PROFILE (1): build_short_name(\'Roberto Yael Peregrina Cruz\') === \'Roberto Y. P. C.\'', () => {
    t.eq(s.build_short_name('Roberto Yael Peregrina Cruz'), 'Roberto Y. P. C.');
  });

  t.test('ONBOARDING-PROFILE: build_short_name handles 2-part and multi-part names', () => {
    t.eq(s.build_short_name('Juan Carlos Rodríguez Heredia'), 'Juan C. R. H.');
    t.eq(s.build_short_name('Rosy Maria Sanchez Cortez'), 'Rosy M. S. C.');
    t.eq(s.build_short_name('Maura Solis'), 'Maura S.');
    t.eq(s.build_short_name('Roberto'), 'Roberto');
    t.eq(s.build_short_name(''), '');
    // Accepts multi-argument shape (nombres, paterno, materno)
    t.eq(s.build_short_name('Roberto Yael', 'Peregrina', 'Cruz'), 'Roberto Y. P. C.');
  });

  // =========================================================================
  // 2. Duplicate prevention (id = auth_user_id)
  // =========================================================================
  t.test('ONBOARDING-PROFILE (2): a second activation for the same auth_user_id does not create a duplicate row', async () => {
    const sb = new FakeSupabase({
      seed: {
        profiles: [],
        onboarding: []
      }
    });

    const onbRow = {
      id: 'onb-roberto-1',
      auth_user_id: 'auth-user-uuid-1234',
      nombres: 'Roberto Yael',
      apellido_paterno: 'Peregrina',
      apellido_materno: 'Cruz',
      email: 'roberto@asianfoodconcepts.mx',
      movil: '5512345678',
      current_step: 4
    };

    // First activation
    await s.activateOnboardingProfile(onbRow, sb);
    const { data: firstRows } = await sb.from('profiles').select('*').eq('id', onbRow.auth_user_id);
    t.eq(firstRows.length, 1, 'first activation must create exactly 1 profile row');
    t.eq(firstRows[0].id, 'auth-user-uuid-1234');
    t.eq(firstRows[0].name, 'Roberto Yael');
    t.eq(firstRows[0].full_name, 'Roberto Yael Peregrina Cruz');
    t.eq(firstRows[0].short_name, 'Roberto Y. P. C.');
    t.eq(firstRows[0].role, null, 'role must be NULL (set by human)');
    t.eq(firstRows[0].branch, null, 'branch must be NULL');
    t.eq(firstRows[0].active, true, 'active must be true');

    // Second activation for the same auth_user_id
    await s.activateOnboardingProfile(onbRow, sb);
    const { data: secondRows } = await sb.from('profiles').select('*').eq('id', onbRow.auth_user_id);
    t.eq(secondRows.length, 1, 'a second activation for the same auth_user_id does not create a duplicate row');
  });

  // =========================================================================
  // 3. Existing profile role/branch/level/active preservation
  // =========================================================================
  t.test('ONBOARDING-PROFILE (3): an existing profile\'s role/branch/level are NOT overwritten by a re-activation', async () => {
    const sb = new FakeSupabase({
      seed: {
        profiles: [
          {
            id: 'auth-user-uuid-1234',
            name: 'Roberto Yael',
            full_name: 'Roberto Yael Peregrina Cruz',
            short_name: 'Roberto Y. P. C.',
            role: 'Mesero',
            branch: 'Roma Norte',
            level: 3,
            area: 'Piso',
            active: true,
            email: 'roberto@asianfoodconcepts.mx',
            phone: '5512345678'
          }
        ]
      }
    });

    // Re-activation with updated contact/name details from onboarding
    const updatedOnb = {
      id: 'onb-roberto-1',
      auth_user_id: 'auth-user-uuid-1234',
      nombres: 'Roberto',
      apellido_paterno: 'Peregrina',
      apellido_materno: 'Cruz',
      email: 'roberto.nuevo@asianfoodconcepts.mx',
      movil: '5587654321',
      current_step: 4
    };

    await s.activateOnboardingProfile(updatedOnb, sb);

    const { data: p } = await sb.from('profiles').select('*').eq('id', 'auth-user-uuid-1234').single();
    t.eq(p.role, 'Mesero', 'existing profile role must NOT be overwritten');
    t.eq(p.branch, 'Roma Norte', 'existing profile branch must NOT be overwritten');
    t.eq(p.level, 3, 'existing profile level must NOT be overwritten');
    t.eq(p.area, 'Piso', 'existing profile area must NOT be overwritten');
    t.eq(p.active, true, 'existing profile active status must NOT be overwritten');

    // Name and contact fields ARE updated
    t.eq(p.name, 'Roberto', 'name must be updated');
    t.eq(p.full_name, 'Roberto Peregrina Cruz', 'full_name must be updated');
    t.eq(p.short_name, 'Roberto P. C.', 'short_name must be updated');
    t.eq(p.email, 'roberto.nuevo@asianfoodconcepts.mx', 'email must be updated');
    t.eq(p.phone, '5587654321', 'phone must be updated');
  });

  // =========================================================================
  // 4. Trigger/helper idempotency under consecutive calls
  // =========================================================================
  t.test('ONBOARDING-PROFILE (4): the trigger/helper is idempotent under two consecutive calls', async () => {
    const sb = new FakeSupabase({
      seed: {
        profiles: []
      }
    });

    const onbRow = {
      id: 'onb-idem-1',
      auth_user_id: 'auth-idem-uuid',
      nombres: 'Roberto Yael',
      apellido_paterno: 'Peregrina',
      apellido_materno: 'Cruz',
      email: 'roberto@asianfoodconcepts.mx',
      movil: '5512345678',
      current_step: 4
    };

    const res1 = await s.activateOnboardingProfile(onbRow, sb);
    const res2 = await s.activateOnboardingProfile(onbRow, sb);

    t.ok(res1 && res2, 'both consecutive calls must succeed without error');
    const { data: all } = await sb.from('profiles').select('*').eq('id', 'auth-idem-uuid');
    t.eq(all.length, 1, 'database state has exactly 1 row');
    t.eq(all[0].name, 'Roberto Yael');
    t.eq(all[0].short_name, 'Roberto Y. P. C.');
  });

  // =========================================================================
  // 5. Fail-closed ACCESS layer
  // =========================================================================
  t.test('ONBOARDING-PROFILE (5): ACCESS layer treats role NULL as level 99 (no access)', () => {
    // Isolated context mimicking realLevel() with role NULL profile
    const gateSandbox = t.sandbox(['realLevel', 'mayUseViewAs', 'isManagement', 'isOwner'], {
      globals: {
        VIEW_AS: null,
        __realProfile: null,
        currentProfile: { id: 'u-no-role', name: 'Roberto Y. P. C.', role: null, level: null, active: true }
      }
    });

    t.eq(gateSandbox.realLevel(), 99, 'profile with role NULL must resolve to level 99');
    t.eq(gateSandbox.mayUseViewAs(true, gateSandbox.realLevel()), false, 'level 99 must not be allowed view-as');
    t.eq(gateSandbox.isManagement(null, null, true), false, 'role NULL must never grant management');
    t.eq(gateSandbox.isOwner(null, null, true), false, 'role NULL must never grant owner');

    // Missing profile altogether
    const missingProfileSandbox = t.sandbox(['realLevel'], {
      globals: {
        VIEW_AS: null,
        __realProfile: null,
        currentProfile: null
      }
    });
    t.eq(missingProfileSandbox.realLevel(), 99, 'missing profile must resolve to level 99');
  });

  // =========================================================================
  // 6. Invisibility fix: row stuck > 24 hours with no profile
  // =========================================================================
  t.test('ONBOARDING-PROFILE (6): onboarding row stuck at same step > 24h with no profile is flagged', () => {
    const now = Date.now();
    const over24hAgo = new Date(now - 25 * 3600 * 1000).toISOString();
    const recent = new Date(now - 2 * 3600 * 1000).toISOString();

    const rowStuck = {
      id: 'onb-stuck',
      current_step: 4,
      updated_at: over24hAgo,
      created_at: over24hAgo,
      hidden_at: null
    };

    const rowFresh = {
      id: 'onb-fresh',
      current_step: 2,
      updated_at: recent,
      created_at: recent,
      hidden_at: null
    };

    t.eq(s.isOnboardingStalled(rowStuck, false), true, 'row with no profile updated >24h ago is stalled');
    t.eq(s.isOnboardingStalled(rowStuck, true), false, 'activated row with profile is not stalled');
    t.eq(s.isOnboardingStalled(rowFresh, false), false, 'recently updated row is not stalled');
    t.eq(s.isOnboardingStalled(Object.assign({}, rowStuck, { hidden_at: '2026-09-25T00:00:00Z' }), false), false, 'hidden/deactivated row is ignored');

    // Render check: the rendered summary row contains the alert line
    t.includes(t.src, 'isOnboardingStalled', 'renderNuevos must check isOnboardingStalled');
    t.includes(t.src, 'nuevo-stalled-alert', 'renderNuevos must emit the stalled alert line');
    t.includes(t.src, '⚠️ Estancado en paso', 'renderNuevos alert line must mention the step and stall');
  });

  // =========================================================================
  // 7. Migration SQL verification
  // =========================================================================
  t.test('ONBOARDING-PROFILE (7): PostgreSQL trigger migration is valid and idempotent', () => {
    const sqlPath = path.join(t.ROOT, 'supabase', 'onboarding_profile_trigger.sql');
    t.ok(fs.existsSync(sqlPath), 'migration file supabase/onboarding_profile_trigger.sql must exist');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    t.includes(sql, 'public.handle_onboarding_profile_activation', 'must declare trigger function');
    t.includes(sql, 'trg_onboarding_profile_activation', 'must create trigger');
    t.includes(sql, 'ON public.onboarding', 'trigger must attach to public.onboarding');
    t.includes(sql, 'current_step', 'trigger must check current_step');
    t.includes(sql, 'build_short_name', 'trigger must call existing build_short_name helper');
    t.includes(sql, 'ON CONFLICT (id) DO UPDATE SET', 'trigger must be idempotent via ON CONFLICT DO UPDATE');
    // Ensure it does not overwrite role, branch, level, or active
    t.ok(!/role\s*=\s*EXCLUDED\.role/i.test(sql), 'trigger update must not overwrite role');
    t.ok(!/branch\s*=\s*EXCLUDED\.branch/i.test(sql), 'trigger update must not overwrite branch');
    t.ok(!/level\s*=\s*EXCLUDED\.level/i.test(sql), 'trigger update must not overwrite level');
    t.ok(!/active\s*=\s*EXCLUDED\.active/i.test(sql), 'trigger update must not overwrite active');
  });
};
