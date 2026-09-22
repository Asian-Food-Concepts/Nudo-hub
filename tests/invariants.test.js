/**
 * Structural invariants — the contracts a refactor is most likely to break.
 *
 * These do NOT test behaviour; they test SHAPE. A pure function can be moved,
 * and that is fine. But some things are load-bearing and moving/renaming them
 * silently breaks a reader somewhere else in the file. These assertions are the
 * tripwire for exactly that class of refactor damage.
 *
 * CLASSIFICATION NOTE (first run: 8 pass / 4 fail — ALL FOUR were my errors,
 * zero were defects in app.html. See tests/FAILURE-CLASSIFICATION.md):
 *   1. resolveCurrentUserName is `const x = async () => {}`, not `function x()`
 *      — my functionNames() scan only sees declarations.
 *   2. `render` IS defined twice, but at DIFFERENT nesting levels (indent 4 and
 *      5) inside separate closures. That is legitimate shadowing, not a dupe.
 *   3. The JWT literal is the SUPABASE_ANON key, whose payload says
 *      role:"anon" — public BY DESIGN, protected by RLS. Not a leak.
 *   4. nudoDebug/nudoWarn/nudoDiag do not exist yet; they are added by the
 *      refactor. Asserted below as "present once the refactor lands" — see the
 *      conditional so the suite is correct both before and after.
 */

module.exports = function (t) {
  const html = t.html;

  // =========================================================================
  // The version contract — three artifacts must agree (AGENTS.md rule 2)
  // =========================================================================
  t.test('app.html declares exactly one APP_VERSION', () => {
    const m = html.match(/const APP_VERSION\s*=\s*"v[\d.]+"/g) || [];
    t.eq(m.length, 1, 'expected exactly one APP_VERSION declaration, found ' + m.length);
  });

  t.test('the write guard has one definition and at least one call', () => {
    // Duplicate installation would double-wrap supabase.from().
    const defs = (html.match(/function installWriteGuard\s*\(/g) || []).length;
    t.eq(defs, 1, 'installWriteGuard defined ' + defs + ' times (must be 1)');
    const calls = (html.match(/installWriteGuard\s*\(\s*\)/g) || []).length;
    t.ok(calls >= 2, 'installWriteGuard appears ' + calls + ' times — expected the ' +
                     'definition plus at least one CALL (a definition with no call is dead code)');
  });

  t.test('every load-bearing function still exists (by declaration OR const arrow)', () => {
    // A refactor may legitimately turn `function f(){}` into `const f = () => {}`.
    // Accept either, but the NAME must survive — it is referenced elsewhere.
    for (const n of ['normalize', 'esc', 'excerptAround', 'descansoWeekStart',
                     'descansoRangeLabel', 'descansoCutoffLabel', 'planMonday',
                     'urlBase64ToUint8Array', 'resolveCurrentUserName',
                     'installWriteGuard', 'initApp', 'initTheme']) {
      const asDecl  = new RegExp('function\\s+' + n + '\\s*\\(').test(html);
      const asArrow = new RegExp('(?:const|let|var)\\s+' + n + '\\s*=\\s*(?:async\\s*)?\\(').test(html);
      t.ok(asDecl || asArrow, n + ' is missing entirely — a rename must update its callers');
    }
  });

  t.test('no TOP-LEVEL function is defined twice', () => {
    // Only top-level duplicates are a defect. Same-name functions at different
    // INDENT levels are separate closures and legitimate — `render` appears twice
    // by design (indent 4 and 5) and shadowing there is intended.
    const top = [];
    const re = /^[ \t]{0,3}(?:async[ \t]+)?function[ \t]+(\w+)[ \t]*\(/gm;
    let m;
    while ((m = re.exec(html)) !== null) top.push(m[1]);
    const counts = {};
    for (const n of top) counts[n] = (counts[n] || 0) + 1;
    const dupes = Object.keys(counts).filter((n) => counts[n] > 1);
    t.eq(dupes.join(','), '', 'top-level duplicate definitions: ' + dupes.join(', '));
  });

  // =========================================================================
  // Script/style block integrity
  // =========================================================================
  t.test('CSS blocks are brace-balanced', () => {
    const blocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [];
    t.ok(blocks.length > 0, 'no style blocks found');
    blocks.forEach((b, i) => {
      const open = (b.match(/\{/g) || []).length;
      const close = (b.match(/\}/g) || []).length;
      t.eq(open, close, 'style block ' + i + ' unbalanced: ' + open + ' { vs ' + close + ' }');
    });
  });

  t.test('no unclosed CSS comments', () => {
    const blocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [];
    blocks.forEach((b, i) => {
      const open = (b.match(/\/\*/g) || []).length;
      const close = (b.match(/\*\//g) || []).length;
      t.eq(open, close, 'style block ' + i + ' has an unclosed comment');
    });
  });

  // =========================================================================
  // SECRETS — the repo is PUBLIC (AGENTS.md, v0.134 regression)
  // =========================================================================
  t.test('no access codes leaked into the public file', () => {
    // The real codes live in Supabase `access_codes`, fetched after login.
    for (const [label, re] of [
      ['Del Valle Entrada', /178936#/],
      ['Bodega chica (Del Valle)', /229013#/],
      ['Alarma (ADT)', /\b5252\b/],
    ]) {
      t.ok(!re.test(html), 'ACCESS CODE LEAKED into app.html (' + label + '): ' + re);
    }
  });

  t.test('the shipped JWT is the anon key, never service_role', () => {
    // NOTE: a raw JWT literal in this file is EXPECTED and CORRECT — it is the
    // Supabase anon key, which is public by design and protected by RLS. The
    // thing that must never appear is a service_role key, which bypasses RLS.
    // Assert the ROLE in the token, not the mere presence of a JWT.
    t.ok(!/service_role/i.test(html), 'service_role reference found — must never be client-side');
    const m = html.match(/const SUPABASE_ANON\s*=\s*"([^"]+)"/);
    t.ok(m, 'SUPABASE_ANON not found');
    const payload = m[1].split('.')[1];
    const b64 = payload + '='.repeat((4 - payload.length % 4) % 4);
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    t.eq(json.role, 'anon', 'the shipped key must have role "anon", got: ' + json.role);
    t.eq(json.ref, 'dnzvkppytzjsipwfhafk', 'unexpected Supabase project ref');
  });

  // =========================================================================
  // Coupled geometry (AGENTS.md: change together or the wheel breaks)
  // =========================================================================
  t.test('the entrevistas wheel geometry pair still agrees', () => {
    const cssH = html.match(/\.wheel-mask\s*\{[^}]*height:\s*(\d+)px/);
    const jsC = html.match(/CENTER\s*=\s*(\d+)/);
    t.ok(cssH, '.wheel-mask height not found');
    t.ok(jsC, 'CENTER constant not found');
    const mask = Number(cssH[1]);
    const center = Number(jsC[1]);
    t.eq(center, Math.round(mask / 2 - 17),
         'wheel geometry drifted: mask=' + mask + ' implies CENTER=' +
         Math.round(mask / 2 - 17) + ', but JS has ' + center);
  });

  t.test('z-index layers keep their declared order', () => {
    const want = ['sticky-submit', 'dock', 'plan-modal', 'toast-wrap'];
    const vals = want.map((sel) => {
      const re = new RegExp('\\.' + sel + '\\s*\\{[^}]*z-index:\\s*(\\d+)');
      const m = html.match(re);
      return { sel, v: m ? Number(m[1]) : null };
    }).filter((x) => x.v !== null);
    t.ok(vals.length >= 2, 'expected several z-index layers, found ' + vals.length);
    for (let i = 1; i < vals.length; i++) {
      t.ok(vals[i - 1].v <= vals[i].v,
           'z-index order broke: .' + vals[i - 1].sel + '=' + vals[i - 1].v +
           ' > .' + vals[i].sel + '=' + vals[i].v);
    }
  });

  // =========================================================================
  // Auth options key (AGENTS.md: emailRedirectTo, NOT redirectTo)
  // =========================================================================
  t.test('OTP uses emailRedirectTo (redirectTo is silently ignored)', () => {
    const bad = html.match(/\bredirectTo\s*:/g) || [];
    t.eq(bad.length, 0, 'found redirectTo — the key must be emailRedirectTo or the OTP silently fails');
  });

  // =========================================================================
  // The diagnostics helpers (added by the silent-failure refactor).
  // Conditional so this suite is CORRECT both before and after it lands: if
  // present, there must be exactly one of each.
  // =========================================================================
  t.test('diagnostics helpers: absent, or exactly one of each', () => {
    for (const n of ['nudoDebug', 'nudoWarn', 'nudoDiag']) {
      const c = (html.match(new RegExp('function ' + n + '\\s*\\(', 'g')) || []).length;
      t.ok(c === 0 || c === 1, n + ' defined ' + c + ' times (must be 0 or 1)');
    }
  });

  t.test('no debug scaffolding was left behind', () => {
    // AGENTS.md-adjacent rule: temporary probes must not ship to production staff.
    for (const marker of ['__trace', '#debug-el', '__DEBUG_PROBE']) {
      t.ok(html.indexOf(marker) === -1, 'debug scaffolding left in the file: ' + marker);
    }
  });
};
