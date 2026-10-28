const CACHE = 'control-pagos-v121';
// Rutas RELATIVAS a propósito: así la app funciona igual en
// ashir7ai-star.github.io/PJ04-CONTROL-PAGOS/ que en un dominio propio, sin
// tener que cambiar código el día que se mude. En un Service Worker, './'
// se resuelve contra la ubicación del propio sw.js.
const ASSETS = [
  './',
  './index.html',
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
      // `cache: 'reload'` obliga a bajar de la RED, saltándose la caché HTTP
      // del navegador. Sin esto, GitHub Pages manda `Cache-Control: max-age=600`
      // y la instalación podía guardar en la caché NUEVA una copia VIEJA de
      // index.html: la versión subía pero el contenido seguía siendo el de
      // antes, y el usuario no veía los cambios aunque todo pareciera bien.
      Promise.allSettled(ASSETS.map(
        u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)
      ))
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
  'ashir-pj04-pagos-api.nr6aco.easypanel.host',   // el backend propio
  'easypanel.host',
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

  // ── El documento HTML: primero la red, la caché como respaldo ──
  //
  // El resto de los archivos (fuentes, librerías de CDN) casi nunca cambian y
  // conviene servirlos de caché. index.html es lo contrario: es lo ÚNICO que
  // cambia en cada actualización. Servirlo de caché hacía que el usuario
  // siguiera viendo una versión vieja aunque el despliegue hubiera salido bien
  // — pasó varias veces y es difícil de diagnosticar, porque todo "funciona".
  //
  // Si no hay red, se usa la copia guardada: la app sigue abriendo sin conexión.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(respuesta => {
          // Se guarda bajo './index.html' y no bajo la URL pedida, para que
          // los enlaces con parámetros (?vista=gastos) no llenen la caché de
          // copias equivalentes.
          const copia = respuesta.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copia)).catch(() => {});
          return respuesta;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ─── Notificaciones del panel de mensajes ─────────────────────────────────
//
// Esto corre aunque la app esté cerrada: es lo que hace que el aviso suene
// como el de WhatsApp y no solo cuando alguien tiene la pestaña abierta.
//
// ⚠️ En iPhone solo funciona si la app está INSTALADA en la pantalla de
// inicio. Desde Safari como página web, Apple no entrega estos eventos. No es
// algo que se pueda resolver acá.
self.addEventListener('push', e => {
  // Un push sin datos legibles igual tiene que mostrar ALGO: los navegadores
  // exigen una notificación visible por cada push recibido, y si no se muestra
  // ninguna, el navegador puede llegar a dar de baja la suscripción.
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }

  const titulo = d.titulo || 'Control de Pagos';
  const cuerpo = d.cuerpo || 'Tenés un mensaje nuevo.';

  e.waitUntil((async () => {
    await self.registration.showNotification(titulo, {
      body: cuerpo,
      icon:  './icons/icon-192.png',
      badge: './icons/icon-192.png',
      // Agrupa por conversación: diez mensajes de la misma persona son UN
      // aviso que se actualiza, no diez avisos apilados.
      tag: d.etiqueta || 'chat',
      renotify: true,
      data: { hilo: d.hilo || '' }
    });

    // Si la app está abierta en otra pestaña, que ponga el número en la
    // pestaña Mensajes AHORA, no en el próximo sondeo. Sin esto, alguien que
    // está en otra pantalla se enteraba hasta medio minuto después.
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    abiertas.forEach(c => c.postMessage({ tipo: 'mensaje-nuevo', hilo: d.hilo || '' }));
  })());
});

// Al tocar la notificación: si la app ya está abierta se la trae al frente, y
// si no, se abre. Abrir siempre una pestaña nueva dejaría al usuario con cinco
// copias de la app tras una tarde de mensajes.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hilo = (e.notification.data && e.notification.data.hilo) || '';

  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        await c.focus();
        // La página decide qué hacer: acá no se sabe si quien mira es
        // administrador ni qué conversación tiene abierta.
        c.postMessage({ tipo: 'abrir-chat', hilo: hilo });
        return;
      }
    }
    // La app estaba CERRADA: no hay ventana a la que avisarle, así que el
    // destino viaja en la URL. Sin esto, tocar la notificación abría la app
    // en la pantalla de inicio y había que ir a buscar la conversación a
    // mano — justo lo que una notificación tiene que ahorrar.
    const destino = self.registration.scope + '?chat=1' +
                    (hilo ? '&hilo=' + encodeURIComponent(hilo) : '');
    await self.clients.openWindow(destino);
  })());
});

// Si el navegador renueva la suscripción por su cuenta, la de la base queda
// muerta y la persona deja de recibir avisos SIN QUE NADA FALLE. Acá no se
// puede hablar con nuestro servidor (no hay sesión), así que se le avisa a la
// app para que vuelva a registrarse la próxima vez que esté abierta.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    abiertas.forEach(c => c.postMessage({ tipo: 'resuscribir' }));
  })());
});

// Escucha mensaje del usuario para activar la nueva versión
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();

  // Responder al "¿qué versión sos?" permite que la página detecte un Service
  // Worker viejo y atascado. Las versiones anteriores a la v51 no contestan
  // esto, y ese silencio es justamente la señal de que hay que reemplazarlas:
  // un SW roto no puede corregirse solo, porque es él mismo el que sirve la app.
  if (e.data === 'VERSION' && e.ports && e.ports[0]) {
    e.ports[0].postMessage(CACHE);
  }
});
