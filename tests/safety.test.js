/**
 * SAFETY — no test run may email or WhatsApp anyone.
 *
 * Ben's standing constraint: "No one should be emailed other than me. No WhatsApp
 * msg sent during testing too."
 *
 * This file does two jobs:
 *   1. PROVE the sandbox's egress recorder is REAL (a recorder that silently
 *      drops everything would make every "nothing was sent" assertion vacuous).
 *   2. PROVE the app's notification paths cannot reach the network from here.
 *
 * The strongest guarantee is structural, not tested: the sandbox provides no
 * socket, and `fetch` records instead of transmitting. A test can only fail to
 * notice egress if the recorder is broken — which job 1 rules out.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (t) {
  const SRC = t.src;

  // =========================================================================
  // 1. The recorder is real
  // =========================================================================
  t.test('SAFETY: the egress recorder actually captures a send attempt', () => {
    const s = t.sandbox([]);
    t.ok(Array.isArray(s.__egress), '__egress must be exposed on the sandbox');
    // Reach the stubbed primitive directly and confirm it is captured.
    const before = s.__egress.length;
    s.fetch('https://example.invalid/email', { method: 'POST' });
    t.eq(s.__egress.length, before + 1, 'fetch() was not recorded');
    t.eq(s.__egress[before].fn, 'fetch');
    t.includes(String(s.__egress[before].args[0]), 'example.invalid',
              'the recorded URL was not preserved');
  });

  t.test('SAFETY: no transport in the sandbox can open a socket', () => {
    const s = t.sandbox([]);
    // Each must be a local stub. If any is undefined, a loaded function could
    // reach for a REAL global by accident through a different path.
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']) {
      t.ok(typeof s[name] === 'function', 'sandbox is missing the ' + name + ' stub');
    }
    // The stub must not be a real implementation. Assert on BEHAVIOUR, not on the
    // function's source text: `'undici' in fn` throws (you cannot use `in` on a
    // function), and a source-string check would be a fragile proxy anyway.
    // A real fetch would reject for an unroutable host; the stub resolves
    // immediately without any DNS or socket work.
    const r = s.fetch('https://this-host-does-not-exist.invalid/x');
    t.ok(r && typeof r.then === 'function', 'the fetch stub must be thenable');
    t.eq(s.__egress[s.__egress.length - 1].fn, 'fetch', 'the call must be RECORDED, proving it is the stub');
    // No Node network module may be reachable from the sandbox.
    for (const mod of ['require', 'process', 'module', 'global', 'Buffer']) {
      t.eq(typeof s[mod], 'undefined', 'sandbox leaked `' + mod + '` — egress is not sealed');
    }
  });

  t.test('SAFETY: a recorded call resolves locally and transmits nothing', async () => {
    const s = t.sandbox([]);
    const r = s.fetch('https://api.twilio.com/2010-04-01/Accounts/x/Messages.json', { method: 'POST' });
    t.ok(r && typeof r.then === 'function', 'the stub must be thenable so await works');
    t.eq(s.__egress[s.__egress.length - 1].fn, 'fetch', 'the Twilio-shaped call was not recorded');
  });

  // =========================================================================
  // 2. The app's notification surfaces cannot send from here
  // =========================================================================
  t.test('SAFETY: the test files contain no network primitive', () => {
    // Static audit of the whole tests/ directory.
    //
    // SHARPENED after a false positive: banning any URL string flagged
    // egress-fire.test.js, whose whole PURPOSE is to contain realistic send URLs
    // as a positive control. A string only becomes egress if it can REACH a real
    // transport, and inside t.sandbox() it cannot — fetch is a recorder there.
    //
    // So the real ban is on the routes that bypass the sandbox:
    //   - require() of a network or process module (the only way to open a socket
    //     or spawn a sender without going through the stubbed globals)
    // A file that merely NAMES a URL must additionally prove it runs sandboxed.
    const dir = path.join(t.ROOT, 'tests');
    const HARD = /require\s*\(\s*['"](?:net|http|https|tls|dns|dgram|child_process|nodemailer)['"]\s*\)/;
    const mentionsUrl = /https?:\/\/[^\s'"`]+/g;
    const offenders = [];
    const unsandboxed = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      const code = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      if (HARD.test(code)) offenders.push(f);
      // A file that names URLs must run them inside the sandbox, where they are inert.
      if (mentionsUrl.test(code) && !/t\.sandbox\(|vm\.runInContext/.test(code)) {
        unsandboxed.push(f);
      }
    }
    t.eq(offenders.length, 0, 'test files requiring a network module: ' + offenders.join(', '));
    t.eq(unsandboxed.length, 0, 'test files naming URLs without the sandbox: ' + unsandboxed.join(', '));
    // Prove the audit is not vacuous: harness.js DOES use require(), so the
    // pattern is live and would catch a network require if one were added.
    t.ok(/require\s*\(/.test(fs.readFileSync(path.join(dir, 'harness.js'), 'utf8')),
         'the require() pattern found nothing at all — audit is vacuous');
  });

  t.test('SAFETY: the app sends mail via Supabase only — never directly', () => {
    // If app.html used smtplib-style direct sending or a mail API, the sandbox's
    // fetch ban would be the only thing between a test and a real message.
    // Confirm the real shape: email goes through a Supabase edge function.
    t.ok(!/smtp|nodemailer|sendgrid|mailgun|@sendgrid/i.test(SRC),
         'app.html appears to send email directly — the egress ban is not sufficient');
    // And confirm the app DOES have the supabase path, so this test is meaningful
    // rather than passing on a file that never emails at all.
    t.includes(SRC, 'supabase', 'app.html should reach Supabase; the check above is vacuous otherwise');
  });

  t.test('SAFETY: no WhatsApp endpoint anywhere in the shipped app', () => {
    // WhatsApp in this system goes through the local bridge (port 3000) and the
    // realtime listener — never from the app. Assert the app cannot do it.
    //
    // MATCH SENDS, NOT WORDS. A naive /whatsapp/i matches the literal form label
    // "Teléfono / WhatsApp" on two phone inputs (lines 1269, 4941), which is a
    // field name, not a capability. Only an endpoint or a graph API call would
    // give a test the power to send a message.
    const endpoints = SRC.match(/https?:\/\/[^\s'"`)]*whatsapp[^\s'"`)]*/gi) || [];
    t.eq(endpoints.length, 0, 'app.html contains a WhatsApp URL: ' + endpoints.join(', '));
    t.ok(!/graph\.facebook\.com/i.test(SRC), 'app.html can call the WhatsApp Cloud API');
    t.ok(!/wa\.me\/\d/i.test(SRC), 'app.html contains a wa.me deep link that would send a message');
    // And prove the check is meaningful: the label really is present, so this test
    // would have caught a URL if one existed.
    t.includes(SRC, 'WhatsApp', 'expected the phone-field label; the audit above is vacuous otherwise');
  });

  // =========================================================================
  // 3. The push path is inert
  // =========================================================================
  t.test('SAFETY: push subscription cannot reach a real push service', () => {
    const s = t.sandbox(['urlBase64ToUint8Array']);
    // The VAPID key is a public value (safe to ship), but subscribing requires a
    // live service worker + push service. Both are stubbed to local objects.
    t.eq(s.navigator.serviceWorker.register('sw.js') instanceof Promise, true,
         'serviceWorker.register must return a local promise');
    t.ok(s.__egress.some((e) => e.fn === 'sw.register'), 'register was not recorded');
  });
};
