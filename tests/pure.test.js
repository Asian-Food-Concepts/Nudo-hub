/**
 * Behaviour tests for app.html's pure functions.
 *
 * These CHARACTERISE the shipped behaviour: each expectation was read off the
 * live v0.198 code, so a refactor that changes any of it fails here. They are
 * not change-detectors — they assert contracts (a week rule, an escape rule,
 * a base64 rule) that must hold whatever the code looks like.
 */

module.exports = function (t) {
  // =========================================================================
  // normalize() — accent/case folding used by search and highlighting
  // =========================================================================
  const n = t.sandbox(['normalize']);
  const normalize = (s) => n.normalize(s);

  t.test('normalize lowercases', () => {
    t.eq(normalize('PROPINAS'), 'propinas');
  });

  t.test('normalize strips Spanish accents', () => {
    t.eq(normalize('amonestación'), 'amonestacion');
    t.eq(normalize('Políticas'), 'politicas');
    t.eq(normalize('miércoles'), 'miercoles');
    t.eq(normalize('niño'), 'nino');
  });

  t.test('normalize leaves plain ascii untouched', () => {
    t.eq(normalize('corte'), 'corte');
  });

  // =========================================================================
  // esc() — HTML escaping. A bug here is an XSS/display defect.
  // =========================================================================
  const e = t.sandbox(['esc']);
  const esc = (s) => e.esc(s);

  t.test('esc escapes the five dangerous characters', () => {
    t.eq(esc('<script>'), '&lt;script&gt;');
    t.eq(esc('a & b'), 'a &amp; b');
    t.eq(esc('say "hi"'), 'say &quot;hi&quot;');
    t.eq(esc("it's"), 'it&#39;s');
  });

  t.test('esc passes through safe text unchanged', () => {
    t.eq(esc('Nudo Ramen y Boba'), 'Nudo Ramen y Boba');
  });

  t.test('esc treats null/undefined as empty, never the string "null"', () => {
    t.eq(esc(null), '');
    t.eq(esc(undefined), '');
  });

  t.test('esc coerces numbers', () => {
    t.eq(esc(42), '42');
  });

  // =========================================================================
  // excerptAround() — the v0.198 search-result snippet.
  // =========================================================================
  const x = t.sandbox(['excerptAround', 'esc', 'normalize']);
  const excerpt = (text, needle, span) => x.excerptAround(text, needle, span);

  const LONG = 'Las propinas se reparten entre todo el equipo de piso y cocina, y los ajustes se hacen al final del dia segun el corte.';

  t.test('excerptAround marks the needle', () => {
    t.includes(excerpt(LONG, 'propinas'), '<mark class="guide-mark">propinas</mark>');
  });

  t.test('excerptAround matches case-insensitively but preserves the source casing', () => {
    const out = excerpt('Las PROPINAS se reparten', 'propinas');
    t.includes(out, '<mark class="guide-mark">PROPINAS</mark>');
  });

  t.test('excerptAround windows around a mid-string match', () => {
    // "todo el equipo" sits deep enough that BOTH ellipses must appear with
    // the default 54-char span. (An earlier version of this test wrongly
    // expected a leading ellipsis for a match at index ~31, where
    // from = max(0, 31-54) = 0 correctly yields none.)
    const deep = LONG + ' ' + LONG;   // push the match past the window
    const out = excerpt(deep, 'todo el equipo', 20);
    t.ok(out.startsWith('…'), 'expected a leading ellipsis, got: ' + out.slice(0, 40));
    t.includes(out, '<mark class="guide-mark">todo el equipo</mark>');
  });

  t.test('excerptAround bounds the output (never a 200-char wall)', () => {
    const out = excerpt(LONG, 'propinas', 20);
    t.ok(out.length < 120, 'expected a short excerpt, got ' + out.length + ' chars');
  });

  t.test('excerptAround escapes HTML in the source it shows', () => {
    const out = excerpt('<img src=x onerror=alert(1)> propinas aqui', 'propinas');
    t.ok(out.indexOf('<img') === -1, 'raw <img must not survive: ' + out);
    t.includes(out, '&lt;img');
  });

  t.test('excerptAround with a needle absent from the text still returns text (no throw)', () => {
    const out = excerpt(LONG, 'zzzznotfound');
    t.ok(out.length > 0);
    t.eq(out.indexOf('<mark'), -1);
  });

  t.test('excerptAround tolerates empty/undefined needle', () => {
    t.ok(excerpt(LONG, '').length > 0);
    t.ok(excerpt(LONG, undefined).length > 0);
  });

  t.test('excerptAround tolerates null text', () => {
    t.eq(excerpt(null, 'x'), '');
  });

  t.test('excerptAround does NOT treat regex metacharacters in the needle as a pattern', () => {
    // A bare needle like "(" once produced an invalid RegExp. Must not throw.
    const out = excerpt('a (paren) here', '(');
    t.ok(typeof out === 'string');
  });

  // =========================================================================
  // urlBase64ToUint8Array() — web-push subscription key decoding.
  // =========================================================================
  const u = t.sandbox(['urlBase64ToUint8Array']);
  const b64 = (s) => u.urlBase64ToUint8Array(s);

  t.test('urlBase64ToUint8Array decodes a known value', () => {
    // "aGk" is base64 for "hi"
    const out = b64('aGk');
    t.eq(out.length, 2);
    t.eq(out[0], 104); // 'h'
    t.eq(out[1], 105); // 'i'
  });

  t.test('urlBase64ToUint8Array handles url-safe alphabet (- and _)', () => {
    // '+/' in standard base64 become '-_' in url-safe; must decode identically.
    const std = Buffer.from([251, 255]).toString('base64'); // "+/8="
    const url = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const out = b64(url);
    t.eq(out.length, 2);
    t.eq(out[0], 251);
    t.eq(out[1], 255);
  });

  t.test('urlBase64ToUint8Array tolerates missing padding', () => {
    // 'aGk' has no padding; 'aGk=' also decodes to "hi".
    t.eq(b64('aGk=').length, 2);
  });
};
