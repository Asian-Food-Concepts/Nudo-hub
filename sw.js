const CACHE = 'nudo-hub-v39'; // v0.142: Fixed container visibility for plan card  // v0.141: Re-habilitado planeador de horarios con advertencias de 48h y turnos rápidos  // v0.140: Onboarding page matches Nudo Hub theme (light/dark/system mode) with theme switcher + copy updated to "¿Eres nuevo al equipo?" across Hub and onboarding page (Ben) // v0.139: safe-area-inset-top on body/sticky elements to prevent iOS PWA status bar / Dynamic Island overlap & scrim darkening; form submit buttons changed from "Enviar..." to "Revisar antes de enviar" across Bitácora, Mantenimiento, Compras and Entrevistas to accurately reflect review step before submission (Ben) // v0.138: enable iOS push notifications — Apple PWA meta tags & apple-touch-icon in head, iOS standalone detection + home-screen guide on toggle tap, synchronous Notification.requestPermission promise/callback compat, direct reg.pushManager.subscribe, RFC 8291 base64url keys via sub.toJSON(), robust push payload handling & SKIP_WAITING message handler // v0.137: login page accepts ENTER to submit (Ben) — the inputs are not in a form so Enter did nothing; bound on BOTH steps (email -> Enviar codigo, 6-digit -> Entrar) by delegating to the existing buttons click handlers, so no login logic was duplicated. Also autofocuses the code box when the OTP step opens. // v0.136: Bitácora form gains SIX sub-headers so the 16 fields read as areas instead of a wall (Ben: 'given that there are many areas, we should have sub-headers for the bitacora so we can categorize them'). Groups in document order: Turno / Equipo y servicio / Producto / Instalaciones / Operación y caja / Cierre. VISUAL ONLY — no field was moved (the Ben-mandated Reservaciones -> Corte -> Propinas order is untouched), no name changed, no required-list change, no review-modal change. New .form-subhead CSS. // v0.135: Bitácora limpieza hint now reads (zona, estándar, pendiente, fauna, fumigación, trampa de grasa) — Ben wants captains prompted to log fumigation + grease-trap service and to report fauna sightings. Label-only change, no schema impact (still temas.limpieza.detalle). // v0.134: 🔴 ACCESS CODES MOVED SERVER-SIDE (Ben: "it should only be visible or extractable after auth"). The door/alarm codes are DELETED from this repo and now live in Supabase table access_codes, RLS-gated to a caller who has a profiles row — NOT merely a valid JWT. NEVER put a code in app.html, sw.js, a comment or a commit message again: both files are PUBLIC. // v0.133: Códigos de acceso card shows the real codes (superseded by v0.134, now server-side) // v0.132: removed the visible 'Página de pruebas (preview)' link from the login page // v0.131: Home gains an 'Instalar la app' card (add to home screen / bookmark) — native beforeinstallprompt on Android, written steps on iOS, self-hides once installed // v0.130: Bitácora radio buttons made uniform — Propinas and Descuentos y Cortesías drop their word labels (✅ Normales/Irregulares, ✅ Ninguno/Sí hubo → bare ✅ / ⚠️) // v0.129: Bitácora gains a 'Corte (¿salió bien?)' category (✅ / ⚠️ + nota) after Reservaciones; Códigos de acceso card shows real door codes again // v0.128: magic words now sign into dedicated PREVIEW profiles (one per rank: capitan, capitanpiso, mesero, cocina, barra, encargado, gerente, gerenteregional, dueno) that do not overlap with live staff accounts (Ben) // v0.127: review-modal ✏️ Editar / ✅ Enviar pinned to the TOP of the box (sticky) — long Bitácora/solicitud reviews no longer push the confirm buttons below the fold (Ben) // v0.126: bottom dock trimmed to Inicio + Seguimiento (Ben) — Planear/Bitácora/Guía tabs removed, reachable via Home cards // v0.119: review modal Solicitante+Fecha rows (Mant+Compras); Mantenimiento 'Otra' sucursal free-text; Estatus renders non-standard branches // v0.118: Semana/Día as full-width tabs + tap-to-open assignment popup (persona+horas) replaces inline dropdowns in week grid // v0.117: Mantenimiento preventivo placeholder card (leaders only, greyed) // v0.116: userbar merged into header card (one unified card) // v0.115: compact wheel picker (112px, highlight-bar realigned) // v0.114: dock-under-modal fix (z-index + modal-open body class) // v0.109: planner fixes (Producción group, branch gating, mobile day-default, 16px/44px selects)
const ASSETS = [
  '/Nudo-hub/',
  '/Nudo-hub/index.html',
  '/Nudo-hub/app.html',
  '/Nudo-hub/live.html',
  '/Nudo-hub/manifest.json',
  '/Nudo-hub/reglas.html',
  '/Nudo-hub/guia.html',
  '/Nudo-hub/contactos.html',
  '/Nudo-hub/onboarding.html'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  // Network-first for navigation, cache-first for assets
  if (e.request.url.includes('version.json')) { e.respondWith(fetch(e.request)); return; }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/Nudo-hub/app.html')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => cached))
  );
});

// ---- PUSH NOTIFICATIONS ----
self.addEventListener('push', e => {
  let data = {};
  if (e.data) {
    try { data = e.data.json(); }
    catch (_) {
      try { data = { body: e.data.text() }; } catch (__) {}
    }
  }
  const title = data.title || 'Nudo Hub';
  const options = {
    body: data.body || '',
    icon: '/Nudo-hub/icon-192.png',
    badge: '/Nudo-hub/icon-192.png',
    data: { url: data.url || '/Nudo-hub/app.html' },
    vibrate: [100, 50, 100]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/Nudo-hub/app.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/Nudo-hub/') && 'focus' in client) {
          try { client.navigate(url); } catch(_) {}
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
