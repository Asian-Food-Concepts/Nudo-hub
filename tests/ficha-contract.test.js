/**
 * Guard the "Ver ficha" / "Generar contrato" additions.
 *
 * WHY THIS FILE EXISTS — two failure modes that are invisible in a screenshot.
 *
 * 1. A DUPLICATED data attribute. The card renderer emits its buttons as a chain of string
 *    concatenations, all `class="btn btn-outline"` and only distinguishable by their
 *    `data-nuevo-*` attribute. While adding the ficha button, `data-nuevo-edit` was emitted
 *    TWICE and `data-nuevo-onboarding` disappeared — which silently broke the existing
 *    "✏️ Editar" button while every other test stayed green, because the file still parsed
 *    and the duplicate simply won the click. So: assert each action attribute appears exactly
 *    once in the renderer.
 *
 * 2. CREDENTIALS LEAKING INTO THE BROWSER. Contract generation needs Drive + Docs. Putting a
 *    Google refresh token in app.html would hand the whole Drive to anyone who opens devtools
 *    on a deployed page of a PUBLIC repo. The button must call a server function and carry no
 *    credential itself. Assert that.
 *
 * NOTE ON SOURCES: `t.src` is the largest inline <script> block (the code), while `t.html` is
 * the whole document (markup included). A markup assertion must use t.html — checking t.src
 * for an element id fails even when the element is present.
 */

module.exports = function (t) {
  const SRC = t.src;                       // the script block (code)
  const HTML = t.html;                     // the whole document (markup + code)
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** The body of the generar-contrato click handler, located by its closest() selector. */
  function genHandler() {
    const i = SRC.indexOf("closest('[data-nuevo-gen]')");
    return i === -1 ? '' : SRC.slice(i, i + 4000);
  }

  t.test('FICHA: one card button per action — no attribute is emitted twice', () => {
    // A rendered button looks like:  data-nuevo-x="' + esc(
    // Click handlers reference the bare attribute via closest('[data-nuevo-x]') and must
    // not be counted, so only the esc( shape counts as a definition.
    const defs = (attr) => {
      const needle = 'data-nuevo-' + attr + '="';
      let n = 0;
      let i = SRC.indexOf(needle);
      while (i !== -1) {
        if (SRC.slice(i + needle.length, i + needle.length + 12).indexOf('esc(') !== -1) n++;
        i = SRC.indexOf(needle, i + 1);
      }
      return n;
    };
    ['edit', 'onboarding', 'ficha', 'gen', 'sendback', 'delete', 'activate'].forEach((a) => {
      const n = defs(a);
      t.ok(n <= 1, 'data-nuevo-' + a + ' is rendered ' + n + ' times — a duplicate overrides the real button');
    });
    t.eq(defs('ficha'), 1, 'the "Ver ficha completa" button must be rendered exactly once');
    t.eq(defs('onboarding'), 1, 'the "Editar" button must be rendered exactly once');
  });

  t.test('FICHA: the ficha opens from a cached row, not a fresh network call', () => {
    const body = t.extractFunction('openNuevoFicha') || '';
    t.ok(body.length > 0, 'openNuevoFicha not found');
    t.includes(body, '__nuevos_cache', 'the ficha must read the already-loaded row list');
  });

  t.test('FICHA: a blank field is shown as a gap, never silently omitted', () => {
    // A reviewer must be able to SEE what is missing; hiding empty fields makes an
    // incomplete registration look complete.
    const body = t.extractFunction('fichaField') || '';
    t.ok(body.length > 0, 'fichaField not found');
    t.ok(/sin llenar/.test(body), 'an empty field must be rendered as a visible gap');
  });

  t.test('FICHA: every onboarding column shown on the ficha is actually SELECTED', () => {
    // A field rendered but not selected shows as "sin llenar" even when the DB holds a
    // value — a silent lie to the reviewer. Scope the scan to the FICHA_SECTIONS table
    // only: other ['a','b'], pairs exist elsewhere in the file.
    const sel = (SRC.match(/\.from\('onboarding'\)\s*\n?\s*\.select\('([^']+)'\)/) || [])[1] || '';
    t.ok(sel.length > 0, 'the onboarding select list was not found');
    const selected = new Set(sel.split(','));

    const start = SRC.indexOf('const FICHA_SECTIONS');
    const end = SRC.indexOf('function fichaField');
    t.ok(start !== -1 && end > start, 'FICHA_SECTIONS table not found');
    const block = SRC.slice(start, end);

    const keys = (block.match(/\['([a-z_]+)',\s*'[^']+'\],/g) || [])
      .map((m) => m.match(/\['([a-z_]+)'/)[1]);
    t.ok(keys.length > 20, 'expected the ficha field tables, found ' + keys.length + ' keys');

    const missing = keys.filter((k) => !selected.has(k));
    // t.eq compares with ===, so two distinct [] are never equal — compare a string.
    t.eq(missing.join(','), '',
         'ficha shows unselected columns (would render as "sin llenar"): ' + missing.join(', '));
  });

  t.test('FICHA: documents are openable via a short-lived signed URL', () => {
    t.includes(CODE, 'createSignedUrl', 'documents must be opened with a signed URL');
    // The select must fetch storage_path or there is nothing to sign. A comment sits
    // between .from() and .select(), so the gap has to allow for it.
    const sel = (SRC.match(/\.from\('onboarding_documents'\)[\s\S]{0,400}?\.select\('([^']+)'\)/) || [])[1] || '';
    t.ok(sel.length > 0, 'the onboarding_documents select list was not found');
    t.includes(sel, 'storage_path', 'storage_path must be selected to sign a document link');
  });

  t.test('CONTRACT: generation is delegated to a server function, with NO credential in the page', () => {
    t.includes(SRC, 'functions/v1/generate-contract',
               'the button must call the generate-contract edge function');
    // A Google credential in this file would be readable by anyone — the repo is PUBLIC.
    ['refresh_token', 'client_secret', 'private_key', 'GOOGLE_APPLICATION',
     'service_account', 'oauth2.googleapis'].forEach((needle) => {
      t.ok(!HTML.includes(needle),
           'app.html contains "' + needle + '" — a Google credential must never ship to the browser');
    });
  });

  t.test('CONTRACT: an undeployed function says so instead of failing silently', () => {
    // Silence may never be ambiguous. A 404 must produce a visible message.
    const h = genHandler();
    t.ok(h.length > 0, 'the generar-contrato handler was not found');
    t.ok(/404/.test(h), 'the handler does not special-case a missing function');
    t.includes(h, 'showMsg', 'a failed generation must be surfaced to the user');
  });

  t.test('CONTRACT: the button refuses when the data needed for a contract is absent', () => {
    const h = genHandler();
    t.includes(h, 'puesto', 'the handler must check the puesto');
    t.includes(h, 'salario_semanal', 'the handler must check the salary');
    t.includes(h, 'fecha_de_ingreso', 'the handler must check the start date');
  });

  t.test('CONTRACT: the request carries the reviewer JWT, not an anon key', () => {
    const h = genHandler();
    t.includes(h, 'getSession', 'the handler must read the current session');
    t.includes(h, "'Authorization'", 'the request must send an Authorization header');
  });

  t.test('FICHA: the modal follows the existing review-modal conventions', () => {
    // Markup lives in the document, not the script block.
    t.includes(HTML, 'id="nuevo-ficha-modal"', 'the modal markup is missing');
    t.includes(HTML, 'class="review-modal hidden"', 'the ficha modal must reuse .review-modal');
    t.includes(HTML, 'id="nuevo-ficha-close"', 'the ficha modal needs a close button');
    t.includes(CODE, 'closeNuevoFicha', 'the ficha modal has no close handler');
  });
};
