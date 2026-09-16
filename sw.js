const CACHE = 'control-pagos-v41';
const ASSETS = [
  '/PJ04-CONTROL-PAGOS/',
  '/PJ04-CONTROL-PAGOS/index.html',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
  'https://cdn.jsdelivr.net/npm/flatpickr',
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/es.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // `addAll` es todo-o-nada: si UNO solo de los assets falla (y acá hay
      // cinco CDN externos), la instalación entera falla, el Service Worker
      // nuevo nunca se activa y el viejo se queda indefinidamente. En redes
      // móviles inestables pasa seguido, y el usuario deja de recibir
      // actualizaciones sin ningún aviso.
      // Con allSettled, lo que se pueda cachear se cachea y lo que no, se
      // pedirá a la red cuando haga falta. La app funciona igual.
      Promise.allSettled(ASSETS.map(u => c.add(u).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Dominios del backend y del login: el Service Worker NO debe tocarlos.
//
// Apps Script entrega la respuesta de un POST con una redirección: primero
// ejecuta doPost en /exec y después manda un 302 a googleusercontent.com, que
// el navegador sigue con un GET. Si ese GET pasa por acá, lo relanzábamos como
// una petición nueva con `fetch(e.request)`, se perdía el contexto de la
// redirección y el navegador terminaba pidiendo `GET /exec` sin parámetros:
// el servidor respondía "Acción no reconocida: undefined" y el login moría ahí.
//
// Era también la causa de que Aprobaciones pareciera fallar aunque el correo sí
// llegara: doPost se ejecutaba bien, lo que se rompía era la entrega de la
// respuesta.
//
// Además, nada de esto se debe cachear nunca: son datos vivos.
const SIN_CACHE = [
  'script.google.com',
  'script.googleusercontent.com',
  'accounts.google.com',
  'oauth2.googleapis.com'
];

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (SIN_CACHE.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // Las respuestas redirigidas no se pueden devolver desde un Service Worker
  // cuando el pedido no está en modo "follow"; se dejan pasar directo.
  if (e.request.mode === 'navigate' && e.request.redirect !== 'follow') return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Escucha mensaje del usuario para activar la nueva versión
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
