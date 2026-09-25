/**
 * Contract generation — the UI must match what the edge function actually does.
 *
 * WHY THESE ASSERTIONS EXIST
 *
 * The `generate-contract` function was deployed and tested independently. This file pins the
 * SEAM between it and `app.html`, because every failure mode here is invisible to both sides
 * tested alone:
 *
 * 1. THE ENDPOINT PATH AND AUTH HEADER MUST MATCH. A typo in the path, or a missing
 *    Authorization header, looks identical to "the feature does nothing" — and the function
 *    would correctly answer 401/404 while the UI showed a generic error.
 *
 * 2. THE STATUS CODES MUST BE INTERPRETED HONESTLY. The UI previously said "la generación en
 *    el servidor todavía no está activa" on 404. That was TRUE when the function was undeployed
 *    and is a LIE now — it would send Ben to ask for work already done. A 403 (not an
 *    owner/manager, or a deactivated account) must NOT be reported as a generic failure,
 *    because the fix is a different person, not a bug report.
 *
 * 3. THE BUTTON MUST ONLY APPEAR WHEN THE CONTRACT DOES NOT EXIST YET. The repo's own
 *    convention: a person with a stored revision gets a DOWNLOAD button, not a regenerate
 *    button. Shipping both would let someone overwrite a signed contract by accident.
 *
 * 4. THE PRE-FLIGHT CHECK MUST STAY. The function refuses with 422 when puesto / salario /
 *    fecha are missing. The UI checking first turns that into a useful instruction ("add the
 *    missing fields") instead of a server error.
 *
 * 5. NO GOOGLE CREDENTIAL MAY EVER APPEAR IN THIS FILE. The repo is PUBLIC. The whole reason
 *    generation moved server-side is that a refresh token in the browser is public.
 */

module.exports = function (t) {
  const SRC = t.src;
  const HTML = t.html;

  t.test('CONTRACT: the call targets the deployed function path', () => {
    const i = SRC.indexOf("functions/v1/generate-contract");
    t.ok(i > -1, 'needle: the generate-contract call exists');
    if (i < 0) return;
    const around = SRC.slice(Math.max(0, i - 500), i + 300);
    t.ok(/method:\s*'POST'/.test(around), 'must POST');
    t.ok(/'Authorization':\s*'Bearer '\s*\+\s*sess\.access_token/.test(around),
      'must send the session JWT — the function verifies it');
    t.ok(/onboarding_id/.test(around), 'must send onboarding_id, which the function requires');
    t.ok(/Content-Type/.test(around), 'must declare JSON');
  });

  t.test('CONTRACT: a missing session is caught before the request', () => {
    const i = SRC.indexOf("functions/v1/generate-contract");
    const before = SRC.slice(Math.max(0, i - 700), i);
    t.ok(/getSession\(\)/.test(before), 'must read the session');
    t.ok(/if\s*\(!sess\)\s*throw/.test(before),
      'must throw when there is no session rather than sending an unauthenticated request');
  });

  t.test('CONTRACT: 404 no longer claims the feature is uninstalled', () => {
    const i = SRC.indexOf("if (res.status === 404)");
    t.ok(i > -1, 'needle: the 404 branch exists');
    if (i < 0) return;
    const branch = SRC.slice(i, i + 600);
    // The stale message would send the owner to request already-completed work.
    t.ok(!/todavía no está activa/.test(branch),
      'must not claim generation is not active — the function IS deployed');
    t.ok(!/que la instale/.test(branch), 'must not ask Oversight to install it again');
    t.ok(/404/.test(branch), 'should name the status so the cause is diagnosable');
  });

  t.test('CONTRACT: 403 is reported as a permission problem, not a failure', () => {
    const i = SRC.indexOf("if (res.status === 403)");
    t.ok(i > -1, 'needle: the 403 branch exists');
    if (i < 0) return;
    const branch = SRC.slice(i, i + 500);
    t.ok(/permiso/.test(branch), 'must say it is a permission issue');
    t.ok(/esc\(/.test(branch), 'the server message must be escaped before display');
  });

  t.test('CONTRACT: the pre-flight check still guards the server 422', () => {
    // Anchor on the HANDLER, not the button markup: the markup appears earlier in the file,
    // so anchoring there searched an unrelated region and produced a false failure.
    const i = SRC.indexOf("e.target.closest('[data-nuevo-gen]')");
    t.ok(i > -1, 'needle: the generate button handler exists');
    if (i < 0) return;
    const body = SRC.slice(i, i + 2500);
    t.ok(/!row\.puesto\s*\|\|\s*row\.salario_semanal == null\s*\|\|\s*!row\.fecha_de_ingreso/.test(body),
      'must check puesto, salario_semanal AND fecha_de_ingreso before calling');
    t.ok(/showMsg\(msgEl,[\s\S]{0,200}return;/.test(body),
      'must SHOW the problem and return without calling the server');
  });

  t.test('CONTRACT: the button becomes a download once a contract exists', () => {
    // revPath drives the branch: download when present, generate when absent.
    const i = SRC.indexOf("revPath\n", SRC.indexOf('data-nuevo-ficha'));
    t.ok(i > -1, 'needle: the revPath branch exists');
    if (i < 0) return;
    const block = SRC.slice(i, i + 700);
    t.ok(/data-nuevo-dl="revision"/.test(block), 'must offer the revision download');
    const genIdx = block.indexOf("data-nuevo-gen");
    t.ok(genIdx > -1, 'must still offer generate in the else branch');
    t.ok(block.indexOf("data-nuevo-dl=\"revision\"") < genIdx,
      'download must come first in the conditional (revPath ? dl : gen)');
  });

  t.test('CONTRACT: no Google credential is anywhere in the shipped files', () => {
    // The repo is public. This is the assertion that matters most if anything here ever
    // regresses: the reason generation is server-side is that the browser is public.
    const bad = [
      /refresh_token/i,
      /client_secret/i,
      /GCONTRACT_/,
      /GOCSPX-/,
      /"private_key"\s*:/,
      /BEGIN PRIVATE KEY/
    ];
    for (const re of bad) {
      t.ok(!re.test(SRC), `app.html must not contain ${re}`);
      t.ok(!re.test(HTML), `rendered HTML must not contain ${re}`);
    }
  });

  t.test('CONTRACT: the client never talks to Google directly', () => {
    for (const host of ['oauth2.googleapis.com', 'www.googleapis.com', 'docs.googleapis.com']) {
      t.ok(SRC.indexOf(host) === -1, `app.html must not call ${host} from the browser`);
    }
  });
};
