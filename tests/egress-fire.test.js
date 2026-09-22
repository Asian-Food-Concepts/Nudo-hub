/**
 * EGRESS UNDER FIRE — prove the ban holds when code really tries to transmit.
 *
 * The other safety tests assert the absence of capability. This one is the
 * positive control: it injects a function that DILIGENTLY attempts to send an
 * email and a WhatsApp message, then asserts that:
 *   (a) the attempt is RECORDED (so the recorder is not silently dropping), and
 *   (b) nothing was actually transmitted.
 *
 * If the recorder were broken, every "nothing was sent" assertion in the suite
 * would be vacuous. This test makes that failure mode impossible to hide.
 *
 * Ben's constraint: "No one should be emailed other than me. No WhatsApp msg sent
 * during testing too."
 */

module.exports = function (t) {
  // A hostile-but-realistic notifier. Written to be as close as possible to what
  // a genuine send would look like, so the ban is exercised on the real path.
  const HOSTILE = `
    async function hostileNotify(to, channel) {
      if (channel === 'email') {
        // The shape supabase-js / a mail API would use.
        const r = await fetch('https://api.example.com/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to, subject: 'test' }),
        });
        return r.status;
      }
      if (channel === 'whatsapp') {
        // The shape the local bridge (port 3000) would use.
        const r = await fetch('http://localhost:3000/send', {
          method: 'POST',
          body: JSON.stringify({ to: to, text: 'test' }),
        });
        return r.status;
      }
      if (channel === 'beacon') {
        navigator.sendBeacon('https://api.example.com/collect', 'payload');
        return 1;
      }
      if (channel === 'ws') {
        const w = new WebSocket('wss://api.example.com/live');
        w.send('hello');
        return 1;
      }
      return -1;
    }
  `;

  /** Load a raw snippet into a fresh sandbox. */
  function withHostile() {
    const s = t.sandbox([]);
    // Injecting the body directly is the only way to test a function that is not
    // in app.html — and it is the strongest form of the test, because the code
    // under it is written to transmit.
    const vm = require('vm');
    vm.runInContext(HOSTILE + '\n;globalThis.hostileNotify = hostileNotify;', s);
    return s;
  }

  t.test('FIRE: an attempted email is RECORDED and NOT delivered', async () => {
    const s = withHostile();
    const before = s.__egress.length;
    await s.hostileNotify('someone@example.com', 'email');
    t.eq(s.__egress.length, before + 1, 'the email attempt was not recorded — recorder is broken');
    const rec = s.__egress[s.__egress.length - 1];
    t.eq(rec.fn, 'fetch');
    t.includes(String(rec.args[0]), 'send-email', 'the recorded URL must be the real one');
    // The body must show the intended recipient, proving the recorder captures
    // the payload (so a test can assert WHO would have been contacted).
    t.includes(JSON.stringify(rec.args), 'someone@example.com');
  });

  t.test('FIRE: an attempted WhatsApp message is RECORDED and NOT delivered', async () => {
    const s = withHostile();
    const before = s.__egress.length;
    await s.hostileNotify('120363405040438825@g.us', 'whatsapp');
    t.eq(s.__egress.length, before + 1, 'the WhatsApp attempt was not recorded');
    const rec = s.__egress[s.__egress.length - 1];
    t.includes(String(rec.args[0]), 'localhost:3000', 'the bridge URL must be captured, not masked');
    t.includes(JSON.stringify(rec.args), 'g.us');
  });

  t.test('FIRE: sendBeacon is recorded, not fired', () => {
    const s = withHostile();
    const before = s.__egress.length;
    s.hostileNotify('x', 'beacon');
    t.eq(s.__egress.length, before + 1, 'sendBeacon attempt not recorded');
    t.eq(s.__egress[s.__egress.length - 1].fn, 'navigator.sendBeacon');
  });

  t.test('FIRE: a WebSocket cannot be opened', () => {
    const s = withHostile();
    const before = s.__egress.length;
    s.hostileNotify('x', 'ws');
    const after = s.__egress.slice(before).map((e) => e.fn);
    t.ok(after.includes('WebSocket') || after.includes('ws.send'),
         'a WebSocket attempt must be recorded; got: ' + after.join(','));
  });

  t.test('FIRE: the egress log accumulates across a whole file run', () => {
    // The list must not be reset per call, or a test could only see its own send.
    const s = withHostile();
    s.hostileNotify('a', 'email');
    s.hostileNotify('b', 'email');
    s.hostileNotify('c', 'whatsapp');
    t.ok(s.__egress.length >= 3, 'egress log must accumulate, saw ' + s.__egress.length);
  });

  t.test('FIRE: the stub returns a usable response shape', async () => {
    // A stub that cannot be used forces tests to mock more, which is how a
    // safety stub gets replaced by the real thing "just to make the test work".
    const s = withHostile();
    const status = await s.hostileNotify('a', 'email');
    t.eq(status, 200, 'the stub must resolve a realistic status');
  });
};
