/**
 * Regression guard for the v0.209.10 onboarding submit deadlock.
 *
 * WHY THIS FILE EXISTS — a bug that made a LEGAL CONSENT unreachable, found by hand.
 *
 * The submit gate (`firstIncompleteStep`) reads `lfpdppp_consent` FROM THE DATABASE.
 * The only statement that ever wrote it (`lfpdppp_consent: true`) sat BEHIND that same
 * gate, and step 4 had no save path at all (buildPayloadFor(4) → null) and no change
 * handler on `#s4-consent`. So the checkbox wrote nothing, the gate always reported the
 * consent missing, and every hire was bounced back to step 4 forever:
 *
 *     "Falta tu consentimiento de privacidad. Te llevamos al paso 4."
 *
 * Proved live on 2026-09-24: NO real registration had ever been submitted (the only
 * submitted rows were script-made PRUEBA rows) and a live applicant was stuck in the loop
 * having re-uploaded his documents six times.
 *
 * These tests are WIRING assertions, not behaviour ones: the failure mode was an ORDERING
 * of two statements, which no unit test of either statement alone can catch.
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE ORDERING CHECKS. The fix documents itself in prose that
 * NAMES the functions involved, so a naive indexOf() matches the comment and reports a
 * bogus order — this bit exactly once while writing these tests. Strip first, then search.
 */

/** Remove // and /* *\/ comments so prose can never masquerade as a call site. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

module.exports = function (t) {
  const ONB = t.onbSrc || '';
  const CODE = stripComments(ONB);

  t.test('ONBOARDING: onboarding.html is loadable by the harness', () => {
    t.ok(ONB.length > 1000, 'onboarding inline script was not found by the harness');
  });

  t.test('ONBOARDING: consent is persisted by a change handler on #s4-consent', () => {
    // The deadlock's first cause: the checkbox wrote nothing. Without a change listener,
    // the tick is lost the moment the page is left or reloaded.
    // `$` is `function $(id){return document.getElementById(id);}` in this file, so the
    // call site reads `$('s4-consent')`.
    t.includes(CODE, "$('s4-consent')", 'the consent box must be referenced');
    const wired = /\$\('s4-consent'\)[\s\S]{0,200}?addEventListener\(\s*['"]change['"]/.test(CODE) ||
                  /addEventListener\(\s*['"]change['"][\s\S]{0,200}?saveConsent/.test(CODE);
    t.ok(wired, 'no change handler persists the consent — a ticked box would save nothing');
  });

  t.test('ONBOARDING: a saveConsent() writer exists and updates the consent columns', () => {
    const body = t.extractOnbFunction('saveConsent') || '';
    t.ok(body.length > 0, 'saveConsent() not found — the only writer of lfpdppp_consent');
    t.includes(body, 'lfpdppp_consent', 'saveConsent must write lfpdppp_consent');
    t.includes(body, 'lfpdppp_consent_at', 'saveConsent must stamp the consent time');
  });

  t.test('ONBOARDING: the submit handler writes consent BEFORE evaluating the gate', () => {
    // ⚠️ THE ACTUAL BUG. The gate reads the DB; the writer must precede it.
    // Pre-fix order was: saveDraftNow() → firstIncompleteStep() → (check) → writer.
    // A refactor that moves the writer back below the gate restores the deadlock while
    // every other test in this suite stays green.
    const submit = CODE.slice(CODE.indexOf("$('s4-submit')"));
    const writeIdx = submit.indexOf('saveConsent');
    const gateIdx = submit.indexOf('firstIncompleteStep');
    t.ok(writeIdx !== -1, 'the submit handler no longer calls saveConsent()');
    t.ok(gateIdx !== -1, 'the submit handler no longer calls firstIncompleteStep()');
    t.ok(writeIdx < gateIdx,
         'DEADLOCK REGRESSION: consent is written AFTER the gate that reads it — ' +
         'submission would be unreachable again');
  });

  t.test('ONBOARDING: the submit handler awaits the consent write', () => {
    // A non-awaited write races the gate that reads it back.
    const submit = CODE.slice(CODE.indexOf("$('s4-submit')"));
    t.ok(/await\s+saveConsent\(\)/.test(submit),
         'saveConsent() is not awaited — the gate could read a stale consent');
  });

  t.test('ONBOARDING: the consent checkbox is validated before the write', () => {
    const submit = CODE.slice(CODE.indexOf("$('s4-submit')"));
    const chk = submit.indexOf("$('s4-consent').checked");
    const wr = submit.indexOf('saveConsent');
    t.ok(chk !== -1, 'the handler no longer checks the checkbox');
    t.ok(chk < wr, 'the handler writes consent before confirming the box is ticked');
  });

  t.test('ONBOARDING: a resumed session restores the consent checkbox', () => {
    const body = stripComments(t.extractOnbFunction('loadStepData') || '');
    t.includes(body, 'lfpdppp_consent', 'loadStepData(4) must read back the stored consent');
  });

  t.test('ONBOARDING: step 4 is registered in colMap so loadStepData(4) does not early-return', () => {
    // loadStepData bails on `if (!colMap[step]) return;`. Step 4 had no entry, so any
    // step-4 restore was silently dead.
    const body = stripComments(t.extractOnbFunction('loadStepData') || '');
    t.ok(/colMap/.test(body), 'colMap not found in loadStepData');
    t.ok(/\b4\s*:\s*['"]/.test(body), 'colMap has no entry for step 4 — restore would early-return');
  });

  t.test('ONBOARDING: uploaded documents are restored so nobody re-uploads them', () => {
    // Second bug found the same night: the ✅ doc marks lived only in the uploading
    // session. One applicant re-uploaded the same four files SIX times.
    const fn = stripComments(t.extractOnbFunction('restoreDocStatuses') || '');
    t.ok(fn.length > 0, 'restoreDocStatuses() not found');
    t.includes(fn, 'onboarding_documents', 'restore must read the stored documents');
    // The DEFINITION is not enough — the helper must be CALLED on resume, or it is dead
    // code. Verified: deleting the call site while keeping the function left this green.
    const load = stripComments(t.extractOnbFunction('loadStepData') || '');
    t.ok(/await\s+restoreDocStatuses\(\)/.test(load),
         'restoreDocStatuses() is defined but never called on resume — dead code');
  });

  t.test('ONBOARDING: the submit path reports a failed consent write loudly', () => {
    // Silence may never be ambiguous: a swallowed consent-write error would look like
    // a successful submit to the applicant.
    const submit = CODE.slice(CODE.indexOf("$('s4-submit')"));
    t.includes(submit, 'reportFailure', 'a failed consent write must be reported, not swallowed');
  });

  t.test('ONBOARDING: consent is never forged — it must come from the checkbox', () => {
    // The fix must NOT be "set lfpdppp_consent = true on the row directly". The consent
    // is only ever true because a human ticked a box in this handler.
    // Verified: `var checked = true;` (a constant) left the earlier assertions green.
    const body = stripComments(t.extractOnbFunction('saveConsent') || '');
    t.includes(body, "$('s4-consent').checked",
               'saveConsent must READ the checkbox state, not assume it');
    t.ok(!/lfpdppp_consent\s*:\s*true/.test(body),
         'saveConsent hardcodes consent to true — that forges a legal consent');
  });
};
