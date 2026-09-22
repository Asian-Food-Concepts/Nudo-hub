/**
 * THE FAKE DOM'S OWN TESTS.
 *
 * A broken fake DOM does not fail loudly — it makes the app look correct while
 * actually testing nothing. That is the most dangerous failure mode in this whole
 * suite, so the fake gets tested harder than the code it supports.
 *
 * Each test below corresponds to a specific way a naive stub would produce a
 * FALSE PASS:
 *   - innerHTML that stores a string instead of parsing it -> every lookup after
 *     a render returns null -> "the app didn't populate anything" looks like a
 *     pass if the assertion is written loosely.
 *   - events that do not bubble -> delegation silently never fires, so the
 *     Cancelar-class bug is invisible.
 *   - querySelector returning null for an UNSUPPORTED selector instead of
 *     throwing -> a test believes it asserted on an element it never found.
 */

const { Document } = require('./fakedom.js');
const { makeEvent } = require('./fakedom.js');

module.exports = function (t) {
  const doc = (html) => new Document(html || '');

  // =========================================================================
  // Parsing
  // =========================================================================
  t.test('DOM: innerHTML PARSES into a queryable tree (not a stored string)', () => {
    const d = doc();
    const host = d.createElement('div');
    d.body.appendChild(host);
    host.innerHTML = '<span class="a"><b id="deep">x</b></span>';
    // The critical assertion: the markup is reachable by query, which a
    // store-only stub cannot satisfy.
    t.ok(host.querySelector('.a'), 'innerHTML was not parsed into elements');
    t.ok(host.querySelector('#deep'), 'nested element not reachable');
    t.eq(host.querySelector('#deep').textContent, 'x');
    // And getElementById must find it document-wide.
    t.ok(d.getElementById('deep'), 'document index did not pick up a parsed id');
  });

  t.test('DOM: innerHTML round-trips through outerHTML', () => {
    const d = doc();
    const host = d.createElement('div');
    host.innerHTML = '<p class="x">hi</p>';
    t.eq(host.innerHTML, '<p class="x">hi</p>', 'round-trip lost fidelity');
  });

  t.test('DOM: void elements do not swallow siblings', () => {
    const d = doc();
    const host = d.createElement('div');
    // An <input> with no close tag must not eat the following elements — the
    // exact shape of every form in the app.
    host.innerHTML = '<input id="a"><input id="b"><div id="c">z</div>';
    t.eq(host.querySelectorAll('input').length, 2, 'void element swallowed a sibling');
    t.ok(host.querySelector('#c'), 'the trailing div was lost');
  });

  t.test('DOM: raw-text elements keep their content literal', () => {
    const d = doc();
    const host = d.createElement('div');
    host.innerHTML = '<script>if (1 < 2) { x(); }</script>';
    t.ok(host.querySelector('script'), 'script element missing');
    t.includes(host.querySelector('script').textContent, '1 < 2', 'script body was mangled');
  });

  t.test('DOM: unquoted and single-quoted attributes parse', () => {
    const d = doc();
    const host = d.createElement('div');
    host.innerHTML = "<a href=/x data-v='q' class=btn id=z>t</a>";
    const a = host.querySelector('a');
    t.eq(a.getAttribute('href'), '/x');
    t.eq(a.dataset.v, 'q');
    t.eq(a.id, 'z');
    t.ok(a.classList.contains('btn'));
  });

  t.test('DOM: text content concatenates across nesting', () => {
    const d = doc();
    const host = d.createElement('div');
    host.innerHTML = '<div>a<span>b<i>c</i></span></div>';
    t.eq(host.textContent, 'abc');
  });

  // =========================================================================
  // Selectors — must be strict
  // =========================================================================
  t.test('DOM: tag, #id, .class and [attr] selectors work', () => {
    const d = doc('<div id="r"><p class="a" data-k="1">x</p><p class="b">y</p></div>');
    t.eq(d.querySelectorAll('p').length, 2);
    t.ok(d.querySelector('#r'));
    t.eq(d.querySelectorAll('.a').length, 1);
    t.eq(d.querySelectorAll('[data-k="1"]').length, 1);
    t.eq(d.querySelectorAll('p.b').length, 1);
  });

  t.test('DOM: descendant and child combinators differ correctly', () => {
    const d = doc('<div class="p"><section><span class="c">x</span></section></div>');
    t.eq(d.querySelectorAll('.p .c').length, 1, 'descendant match failed');
    // A direct-child selector must NOT match a grandchild — if the two are
    // conflated, containment bugs look like successes.
    t.eq(d.querySelectorAll('.p > .c').length, 0, 'child combinator behaved like descendant');
    t.eq(d.querySelectorAll('section > .c').length, 1);
  });

  t.test('DOM: attribute operators work', () => {
    const d = doc('<input id="a" name="b-sucursal" value="Roma Norte"><input id="b" name="b-otra">');
    t.eq(d.querySelectorAll('input[name="b-sucursal"]').length, 1);
    t.eq(d.querySelectorAll('input[name^="b-"]').length, 2, 'prefix match failed');
    t.eq(d.querySelectorAll('input[name$="sucursal"]').length, 1, 'suffix match failed');
    t.eq(d.querySelectorAll('[name]').length, 2, 'presence match failed');
  });

  t.test('DOM: :checked matches checked radios and selected options', () => {
    const d = doc('<input type="radio" name="s" value="RN" checked><input type="radio" name="s" value="DV">'
      + '<select><option>a</option><option selected>b</option></select>');
    const r = d.querySelectorAll('input[name="s"]:checked');
    t.eq(r.length, 1, ':checked did not filter');
    t.eq(r[0].value, 'RN');
    t.eq(d.querySelectorAll('option:checked').length, 1);
  });

  t.test('DOM: an UNSUPPORTED selector THROWS instead of returning nothing', () => {
    // This is the single most important test here. Returning null/[] for a
    // selector the stub cannot parse would let a test "assert" on nothing and
    // report a pass.
    const d = doc();
    for (const bad of ['p + p', 'p ~ p', ':nth-child(2)', ':not(.a)', 'p::before']) {
      let threw = false;
      try { d.querySelectorAll(bad); } catch (e) { threw = true; }
      t.ok(threw, 'selector "' + bad + '" must throw, not silently return []');
    }
  });

  t.test('DOM: closest walks up through parents', () => {
    const d = doc('<div class="wrap"><div class="mid"><button id="b">x</button></div></div>');
    t.eq(d.getElementById('b').closest('.wrap').getAttribute('class'), 'wrap');
    t.eq(d.getElementById('b').closest('button').id, 'b');
    t.eq(d.getElementById('b').closest('.nope'), null);
  });

  // =========================================================================
  // Events — must BUBBLE
  // =========================================================================
  t.test('DOM: events BUBBLE to delegated ancestors', () => {
    // The Cancelar bug: a handler on a container never saw a click from a SIBLING.
    // A non-bubbling stub cannot express that difference, so it cannot catch it.
    const d = doc('<div id="list"><button id="btn">x</button></div>');
    let got = null;
    d.getElementById('list').addEventListener('click', (e) => { got = e.target.id; });
    d.getElementById('btn').click();
    t.eq(got, 'btn', 'the click did not bubble to the delegated parent');
  });

  t.test('DOM: a SIBLING outside the container does NOT reach it', () => {
    // The positive-and-negative pair. This is the actual Cancelar failure shape.
    const d = doc('<div id="app"><div id="list"></div><div id="modal"><button id="m">x</button></div></div>');
    let seen = false;
    d.getElementById('list').addEventListener('click', () => { seen = true; });
    d.getElementById('m').click();
    t.eq(seen, false, 'a click on a sibling container must NOT reach the delegated listener');
    // ...but it DOES reach an ancestor, which is why binding directly works.
    let ancestor = false;
    d.getElementById('app').addEventListener('click', () => { ancestor = true; });
    d.getElementById('m').click();
    t.eq(ancestor, true, 'the event must still bubble to a true ancestor');
  });

  t.test('DOM: stopPropagation halts the bubble', () => {
    const d = doc('<div id="p"><button id="c">x</button></div>');
    let parent = false;
    d.getElementById('p').addEventListener('click', () => { parent = true; });
    d.getElementById('c').addEventListener('click', (e) => e.stopPropagation());
    d.getElementById('c').click();
    t.eq(parent, false, 'stopPropagation was ignored');
  });

  t.test('DOM: preventDefault is recorded', () => {
    const d = doc('<form id="f"><button id="b">x</button></form>');
    const f = d.getElementById('f');
    let prevented = null;
    f.addEventListener('submit', (e) => { e.preventDefault(); prevented = e.defaultPrevented; });
    f.dispatchEvent(makeEvent('submit'));
    t.eq(prevented, true, 'preventDefault did not flag the event');
  });

  t.test('DOM: removeEventListener actually detaches', () => {
    const d = doc('<button id="b">x</button>');
    let n = 0;
    const fn = () => { n++; };
    const b = d.getElementById('b');
    b.addEventListener('click', fn);
    b.click();
    b.removeEventListener('click', fn);
    b.click();
    t.eq(n, 1, 'the listener fired after removal');
  });

  // =========================================================================
  // Tree mutation
  // =========================================================================
  t.test('DOM: appendChild moves a node rather than duplicating it', () => {
    const d = doc('<div id="a"><span id="s"></span></div><div id="b"></div>');
    const s = d.getElementById('s');
    d.getElementById('b').appendChild(s);
    t.eq(d.querySelectorAll('span').length, 1, 'the node was duplicated instead of moved');
    t.ok(d.getElementById('b').contains(s));
  });

  t.test('DOM: remove() detaches from the parent', () => {
    const d = doc('<ul id="u"><li id="x">a</li><li id="y">b</li></ul>');
    d.getElementById('x').remove();
    t.eq(d.querySelectorAll('li').length, 1);
    t.eq(d.getElementById('u').children.length, 1);
  });

  t.test('DOM: classList add/remove/toggle/contains are consistent with className', () => {
    const d = doc('<div id="e" class="a"></div>');
    const e = d.getElementById('e');
    e.classList.add('b', 'c');
    t.eq(e.className.trim(), 'a b c');
    e.classList.remove('b');
    t.eq(e.classList.contains('b'), false);
    t.eq(e.classList.toggle('a'), false, 'toggle on a present class must return false');
    t.eq(e.classList.toggle('z'), true, 'toggle on an absent class must return true');
    t.eq(e.classList.toggle('z', false), false, 'forced toggle must honour the force arg');
  });

  t.test('DOM: dataset reads and writes data- attributes', () => {
    const d = doc('<div id="e" data-horas="3" data-tipo=""></div>');
    const e = d.getElementById('e');
    t.eq(e.dataset.horas, '3');
    e.dataset.multiWord = 'v';
    t.eq(e.getAttribute('data-multi-word'), 'v', 'camelCase dataset did not map to kebab attribute');
  });

  // =========================================================================
  // Forms — the shape the app actually uses
  // =========================================================================
  t.test('DOM: radio value wins through a :checked query (the sucursal pattern)', () => {
    // Mirrors currentBitacoraSucursal(): querySelector('input[name="b-sucursal"]:checked').value
    const d = doc('<input type="radio" name="b-sucursal" value="Roma Norte">'
      + '<input type="radio" name="b-sucursal" value="Del Valle" checked>');
    const r = d.querySelector('input[name="b-sucursal"]:checked');
    t.ok(r, 'the checked radio was not found');
    t.eq(r.value, 'Del Valle');
  });

  t.test('DOM: an UNCHECKED radio set yields null (so the app can fall back)', () => {
    const d = doc('<input type="radio" name="b-sucursal" value="Roma Norte">');
    t.eq(d.querySelector('input[name="b-sucursal"]:checked'), null);
  });

  t.test('DOM: select value and options behave', () => {
    const d = doc('<select id="s"><option value="">—</option><option value="a">A</option></select>');
    const s = d.getElementById('s');
    t.eq(s.options.length, 2);
    s.value = 'a';
    t.eq(s.value, 'a');
  });

  t.test('DOM: input .value is independent of the value attribute', () => {
    // Typing does not change the attribute; a stub that conflates them makes an
    // "unsaved form" test pass when the field was in fact filled.
    const d = doc('<input id="i" value="initial">');
    const i = d.getElementById('i');
    i.value = 'typed';
    t.eq(i.value, 'typed');
    t.eq(i.getAttribute('value'), 'initial', 'the attribute must NOT change with .value');
  });

  t.test('DOM: checkbox .checked toggles without touching the attribute', () => {
    const d = doc('<input type="checkbox" id="c">');
    const c = d.getElementById('c');
    t.eq(c.checked, false);
    c.checked = true;
    t.eq(c.checked, true);
    t.eq(c.hasAttribute('checked'), false, 'setting .checked must not add the attribute');
  });

  // =========================================================================
  // Honest limits — asserted so nobody trusts this more than they should
  // =========================================================================
  t.test('DOM: LIMIT — no layout, geometry is always zero', () => {
    const d = doc('<div id="e" style="width:100px"></div>');
    const e = d.getElementById('e');
    t.eq(e.offsetWidth, 0, 'offsetWidth must stay 0; do not build tests on measured size');
    t.eq(e.getBoundingClientRect().height, 0);
  });

  t.test('DOM: LIMIT — document.activeElement tracks focus()', () => {
    const d = doc('<input id="i"><input id="j">');
    d.getElementById('j').focus();
    t.eq(d.activeElement.id, 'j', 'focus did not update activeElement');
  });

  t.test('DOM: createElement + appendChild round-trips through innerHTML', () => {
    const d = doc();
    const div = d.createElement('div');
    const s = d.createElement('span');
    s.textContent = 'hola';
    div.appendChild(s);
    t.eq(div.innerHTML, '<span>hola</span>');
  });

  t.test('DOM: a full document parses head and body', () => {
    const d = doc('<html><head><title>T</title></head><body><div id="app">x</div></body></html>');
    t.eq(d.querySelector('title').textContent, 'T');
    t.ok(d.getElementById('app'), 'body content not indexed');
    t.eq(d.body.id, '', 'body should be found, not fabricated');
  });
};
