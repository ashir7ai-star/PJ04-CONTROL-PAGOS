// La notificación que suena en el teléfono.
//
// ─── Quién la recibe ──────────────────────────────────────────────────────
//
// Al revés de quien escribió:
//   · escribe un administrador  → le suena al EMPLEADO del hilo
//   · escribe el empleado       → les suena a TODOS los administradores activos
//
// Lo segundo es consecuencia de que el hilo sea compartido: si solo le sonara
// a uno, el mensaje dependería de que esa persona esté mirando.
//
// ─── Las suscripciones muertas se borran ──────────────────────────────────
//
// Un endpoint deja de existir cuando alguien desinstala la app, limpia los
// datos del navegador o cambia de teléfono. El servicio de push responde 404 o
// 410, y si no se borra la fila, ese error se repite en CADA mensaje para
// siempre. Es la forma en que una tabla de suscripciones se llena de basura y
// el envío se vuelve lento sin que nadie entienda por qué.
//
// ⚠️ Solo se borra ante 404/410, que significan "esto ya no existe". Un 500 o
// un tiempo agotado son problemas pasajeros del servicio de push: borrar ahí
// dejaría a alguien sin notificaciones por una caída ajena de diez minutos.

// Cuánto del mensaje viaja en la notificación. Lo suficiente para saber si hay
// que atender ahora; el resto se lee en la app.
const LARGO_VISTA = 120;

function recortar(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > LARGO_VISTA ? t.slice(0, LARGO_VISTA - 1) + '…' : t;
}

// `op.enviar(suscripcion, carga)` -> Promise, lanza con `.statusCode` si falla.
// `op.consulta(sql, params)` -> Promise<{ rows }>
// Entran por parámetro para poder probar esto sin red y sin web-push.
function crearPush(op) {
  const consulta = op.consulta;
  const enviar   = op.enviar;

  // A qué correos hay que avisarle de este mensaje.
  function destinatarios(d) {
    if (d.esAdmin) return [d.hilo];
    return (d.personas || [])
      .filter(function (p) { return p.rol === 'admin'; })
      .map(function (p) { return p.correo; });
  }

  async function avisar(d) {
    const correos = destinatarios(d).filter(Boolean);
    if (!correos.length) return { enviadas: 0, borradas: 0 };

    const r = await consulta(
      'SELECT endpoint, datos FROM suscripciones WHERE correo = ANY($1::text[])',
      [correos]);
    if (!r.rows.length) return { enviadas: 0, borradas: 0 };

    const carga = JSON.stringify({
      titulo: d.mensaje.nombre,
      cuerpo: recortar(d.mensaje.texto),
      // Para que al tocar la notificación se abra la conversación correcta.
      hilo:   d.hilo,
      // Agrupa las notificaciones del mismo hilo en vez de apilar diez avisos
      // sueltos del mismo remitente.
      etiqueta: 'chat-' + d.hilo
    });

    let enviadas = 0;
    const muertas = [];

    await Promise.all(r.rows.map(async function (fila) {
      const sus = typeof fila.datos === 'string' ? JSON.parse(fila.datos) : fila.datos;
      try {
        await enviar(sus, carga);
        enviadas++;
      } catch (err) {
        const codigo = err && (err.statusCode || err.status);
        if (codigo === 404 || codigo === 410) muertas.push(fila.endpoint);
        else console.error('[push] ' + fila.endpoint.slice(0, 40) + '…: ' + (err && err.message));
      }
    }));

    if (muertas.length) {
      await consulta('DELETE FROM suscripciones WHERE endpoint = ANY($1::text[])', [muertas]);
    }
    return { enviadas: enviadas, borradas: muertas.length };
  }

  return { avisar: avisar, destinatarios: destinatarios, recortar: recortar };
}

// El envío real, con web-push. Se arma una sola vez.
//
// Si faltan las claves VAPID, `avisar` queda en una función que no hace nada:
// el chat sigue funcionando sin notificaciones, en vez de que cada mensaje
// enviado falle. Un canal sin aviso es peor que con aviso; sin canal es peor
// que las dos cosas.
function envioReal() {
  const publica  = process.env.VAPID_PUBLICA;
  const privada  = process.env.VAPID_PRIVADA;
  const subject  = process.env.VAPID_SUBJECT || 'mailto:ai@ylevigroup.com';
  if (!publica || !privada) return null;

  const webpush = require('web-push');
  webpush.setVapidDetails(subject, publica, privada);
  return function (suscripcion, carga) {
    return webpush.sendNotification(suscripcion, carga);
  };
}

module.exports = { crearPush: crearPush, envioReal: envioReal, LARGO_VISTA: LARGO_VISTA };
