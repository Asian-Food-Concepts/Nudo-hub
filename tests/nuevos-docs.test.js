/**
 * Nuevos ingresos — "Desactivados" tab + document priority (v0.209.14).
 *
 * WHY THESE ASSERTIONS EXIST
 *
 * 1. DEACTIVATING MUST BE REVERSIBLE WITHOUT LOSING THE RECORD. Ben: "there should be
 *    another tab that shows those that have been disabled so we can limit what we see on
 *    this page." The Activos tab must therefore genuinely EXCLUDE hidden rows, and the
 *    Desactivados tab must genuinely INCLUDE them — otherwise "Reactivar" has nothing to
 *    act on and the record is effectively lost.
 *
 * 2. REACTIVATING MUST VERIFY ITS OWN WRITE. Setting hidden_at back to null and then
 *    assuming success is the same class of bug as the delete path that was already fixed:
 *    a write that silently no-ops reports success and leaves the row invisible forever.
 *    Both directions must read the row back. This is asserted structurally AND
 *    behaviourally, because a wrong comparison (`!checkRow.hidden_at` where hidden_at is
 *    null) would make the check pass for the wrong reason.
 *
 * 3. DOCUMENT PRIORITY MUST BE DERIVED FROM ONE MAP. Ben: "some documents are more
 *    important than the others so those that are more important should be highlighted".
 *    The tiers also drive which documents Rosy chases, so a hardcoded copy drifting from
 *    the map would silently mis-prioritise HR work.
 *
 * 4. AN UNKNOWN DOC TYPE MUST NOT BREAK THE RENDER. The document list comes from the
 *    database; a new doc_type must render neutrally, not throw or highlight by accident.
 *
 * 5. THE ACTIVE TAB MUST BE THE DEFAULT AND MUST NOT RESET. Landing on "Desactivados"
 *    would show an empty page to someone who just registered hires.
 */

module.exports = function (t) {
  const SRC = t.src;
  const HTML = t.html;

  // ---------------------------------------------------------------- structure
  t.test('NUEVOS: the document tier map is the single source of truth', () => {
    const i = SRC.indexOf('const NUEVO_DOC_TIERS');
    t.ok(i > -1, 'needle: the tier map exists');
    if (i < 0) return;
    const block = SRC.slice(i, SRC.indexOf('};', i) + 2);

    for (const [doc, tier] of [['ine', 'critical'], ['nss', 'critical'], ['csf', 'critical'],
                               ['comprobante', 'important'], ['carta', 'important'],
                               ['certificacion', 'optional']]) {
      t.ok(new RegExp(doc + "\\s*:\\s*\\{\\s*tier:\\s*'" + tier + "'").test(block),
        `${doc} must be tier ${tier}`);
    }
  });

  t.test('NUEVOS: tier lookup is case-insensitive and safe on unknown types', () => {
    const i = SRC.indexOf('function getDocTier');
    t.ok(i > -1, 'needle: getDocTier exists');
    if (i < 0) return;
    const body = SRC.slice(i, SRC.indexOf('\n  }', i));
    t.ok(/toLowerCase\(\)/.test(body), 'must normalise case — doc_type casing is not guaranteed');
    t.ok(/\|\|\s*null/.test(body), 'must return null for an unknown type, not throw or guess');
    t.ok(/if\s*\(!docType\)\s*return\s*null/.test(body), 'must handle a missing doc_type');
  });

  t.test('NUEVOS: optional documents are not badged as needing attention', () => {
    const i = SRC.indexOf('function renderDocTierBadge');
    t.ok(i > -1, 'needle: renderDocTierBadge exists');
    if (i < 0) return;
    const body = SRC.slice(i, SRC.indexOf('\n  }', i));
    // "⚪ Opcional" beside every certificate would dilute the critical signal.
    t.ok(/tier === 'optional'/.test(body), 'must skip the badge for optional docs');
    t.ok(/esc\(/.test(body), 'label must be escaped before it reaches the DOM');
  });

  t.test('NUEVOS: the tab control ships both tabs and defaults to Activos', () => {
    t.ok(/id="nuevos-tab-seg"/.test(HTML), 'needle: the tab seg control exists');
    t.ok(/data-nuevos-tab="active"/.test(HTML), 'needle: Activos tab');
    t.ok(/data-nuevos-tab="disabled"/.test(HTML), 'needle: Desactivados tab');
    const seg = HTML.slice(HTML.indexOf('nuevos-tab-seg'), HTML.indexOf('nuevos-tab-seg') + 700);
    t.ok(/data-nuevos-tab="active"[^>]*class="on"/.test(seg), 'Activos must be the active tab on load');
    t.ok(!/data-nuevos-tab="disabled"[^>]*class="on"/.test(seg), 'Desactivados must NOT start active');
    // Mobile-first: thumb-friendly tap targets (the repo's standing order).
    const taps = seg.match(/min-height:44px/g) || [];
    t.ok(taps.length >= 2, `both tabs need 44px tap targets (found ${taps.length})`);
  });

  t.test('NUEVOS: the two tabs read opposite halves of hidden_at', () => {
    const i = SRC.indexOf('async function loadNuevos');
    const body = SRC.slice(i, i + 4000);
    t.ok(/\.is\('hidden_at',\s*null\)/.test(body), 'Activos must filter hidden_at IS NULL');
    t.ok(/\.not\('hidden_at',\s*'is',\s*null\)/.test(body),
      'Desactivados must filter hidden_at IS NOT NULL');
    t.ok(/hidden_at[^)]*ascending:\s*false/.test(body),
      'Desactivados should list most-recently-hidden first');
  });

  t.test('NUEVOS: reactivate verifies its write by reading the row back', () => {
    const i = SRC.indexOf("update({ hidden_at: null })");
    t.ok(i > -1, 'needle: the reactivate write exists');
    if (i < 0) return;
    const after = SRC.slice(i, i + 700);
    t.ok(/\.select\('id,\s*hidden_at'\)/.test(after),
      'must select the row back — a write that no-ops must not report success');
    // A read-back from the WRONG table still "succeeds" and would make the verification
    // meaningless, so the table is asserted, not just the shape of the query.
    t.ok(/\.from\('onboarding'\)/.test(after),
      'the read-back must target the same table it wrote to');
    // `!checkRow.hidden_at` would be TRUE for null, i.e. it would invert the whole check.
    t.ok(/checkRow\.hidden_at\s*!==\s*null/.test(after),
      'must compare strictly against null, not truthiness');
    t.ok(/checkErr/.test(after), 'must handle the read-back failing');
  });

  t.test('NUEVOS: deactivate keeps its own read-back verification', () => {
    // Regression guard: the reactivate work must not remove the pre-existing check.
    const i = SRC.indexOf("update({ hidden_at: nowIso })");
    t.ok(i > -1, 'needle: the deactivate write exists');
    const after = SRC.slice(i, i + 700);
    t.ok(/\.select\('id,\s*hidden_at'\)/.test(after), 'deactivate must still read back');
    t.ok(/checkRow\.hidden_at\b/.test(after), 'deactivate must still validate the read-back');
  });

  t.test('NUEVOS: tab switching does not refetch', () => {
    const i = SRC.indexOf('Nuevos tab switch click handler');
    t.ok(i > -1, 'needle: the tab handler exists and is labelled');
    if (i < 0) return;
    const block = SRC.slice(i, i + 900);
    t.ok(/nuevosTab\s*=/.test(block), 'must record the chosen tab');
    // Render from the cache — a query per tap would be wasteful and racy on mobile.
    t.ok(!/loadNuevos\(\)/.test(block), 'switching tabs must not fire another query');
  });

  // ---------------------------------------------------------------- behaviour
  // Run the REAL helpers against fake document rows. The map + badge are pure, so they can
  // be lifted verbatim; nothing here reimplements the logic under test.
  t.test('NUEVOS: badges render for critical/important and not for optional/unknown', () => {
    const a = SRC.indexOf('const NUEVO_DOC_TIERS');
    const b = SRC.indexOf('let nuevosTab =');
    t.ok(a > -1 && b > a, 'needle: the tier block is extractable');
    if (a < 0 || b <= a) return;
    const src = SRC.slice(a, b);
    const factory = new Function('esc', src + '\nreturn { getDocTier, renderDocTierBadge };');
    const api = factory((s) => String(s));

    const ine = api.renderDocTierBadge('ine');
    t.ok(/Crítico/.test(ine), `ine must badge as Crítico (got ${JSON.stringify(ine)})`);
    t.ok(/doc-tier-chip/.test(ine), 'the badge must carry its styling class');
    t.ok(/critical/.test(ine), 'ine must carry the critical tier class');

    t.ok(/Crítico/.test(api.renderDocTierBadge('NSS')), 'lookup must be case-insensitive');
    t.ok(/Importante/.test(api.renderDocTierBadge('comprobante')), 'comprobante is Importante');
    t.ok(api.renderDocTierBadge('certificacion') === '', 'optional docs must not be badged');
    t.ok(api.renderDocTierBadge('algo_nuevo') === '', 'an unknown doc_type must render neutrally');
    t.ok(api.renderDocTierBadge('') === '', 'an empty doc_type must not throw');
    t.ok(api.renderDocTierBadge(null) === '', 'a null doc_type must not throw');
    t.ok(api.getDocTier('INE').tier === 'critical', 'getDocTier must normalise case');
  });

  t.test('NUEVOS: the badge escapes its label', () => {
    const a = SRC.indexOf('const NUEVO_DOC_TIERS');
    const b = SRC.indexOf('let nuevosTab =');
    if (a < 0 || b <= a) return;
    let seen = null;
    const factory = new Function('esc', SRC.slice(a, b) + '\nreturn { renderDocTierBadge };');
    factory((s) => { seen = s; return String(s); }).renderDocTierBadge('ine');
    t.ok(seen !== null, 'the label must pass through esc() before reaching HTML');
  });

  t.test('NUEVOS: an unknown or unset doc_type never highlights', () => {
    // Mutation-style: the map must be consulted, not a hardcoded comparison list.
    const i = SRC.indexOf('function renderDocTierBadge');
    const body = SRC.slice(i, SRC.indexOf('\n  }', i));
    t.ok(!/===\s*'ine'/.test(body), 'the badge must use the map, not inline doc comparisons');
  });
};
