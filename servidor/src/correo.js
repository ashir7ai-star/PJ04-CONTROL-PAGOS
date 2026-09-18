// Envío de correo por la API de Gmail, con la misma autorización que Drive.
//
// ─── Por qué NO bloquea la respuesta ──────────────────────────────────────
//
// En Apps Script, `MailApp.sendEmail` frenaba la ejecución hasta que el correo
// salía. Acá no: los correos se juntan mientras corre la lógica y se mandan
// DESPUÉS de haberle respondido al usuario.
//
// El motivo es el que ya escribió el propio `apps-script.gs` en sus try/catch:
// *"el alta ya quedó registrada; el correo es un extra"*. Si el pago se
// guardó, la persona tiene que ver su confirmación ya — no esperar a que el
// servidor de correo conteste. Y si el correo falla, eso no puede deshacer ni
// ensuciar una operación que salió bien.
//
// ⚠️ La contra es que un fallo de envío no llega al usuario. Por eso queda en
// el registro del servidor: sin eso, un correo que nunca sale es invisible.

const { google } = require('googleapis');

function autorizacion() {
  const inline = process.env.DRIVE_TOKEN_JSON;
  if (inline && inline.trim()) return JSON.parse(inline);

  const ruta = process.env.DRIVE_TOKEN_ARCHIVO;
  if (ruta && ruta.trim()) {
    const path = require('path');
    return require(path.resolve(process.cwd(), ruta));
  }
  throw new Error('Falta la autorización de Google para enviar correo.');
}

let clienteCache = null;
async function cliente() {
  if (clienteCache) return clienteCache;
  const t = autorizacion();
  const oAuth = new google.auth.OAuth2(t.client_id, t.client_secret);
  oAuth.setCredentials({ refresh_token: t.refresh_token });
  clienteCache = google.gmail({ version: 'v1', auth: oAuth });
  return clienteCache;
}

// Un asunto con tildes o eñes tiene que ir codificado, o llega ilegible.
function asuntoCodificado(texto) {
  const t = String(texto || '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(t)) return t;
  return '=?UTF-8?B?' + Buffer.from(t, 'utf8').toString('base64') + '?=';
}

// Arma el mensaje en el formato que entiende el correo.
//
// Se mandan las dos versiones —texto y HTML— porque es lo que hacía Apps
// Script: el cliente de correo elige la que puede mostrar, y un lector que no
// soporte HTML igual lee el mensaje.
function construirMensaje(m) {
  const limite = 'lim_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const cabeceras = [
    'To: ' + m.to,
    'Subject: ' + asuntoCodificado(m.subject),
    'MIME-Version: 1.0'
  ];

  if (!m.htmlBody) {
    cabeceras.push('Content-Type: text/plain; charset="UTF-8"');
    cabeceras.push('Content-Transfer-Encoding: base64');
    return cabeceras.join('\r\n') + '\r\n\r\n' +
           Buffer.from(String(m.body || ''), 'utf8').toString('base64');
  }

  cabeceras.push('Content-Type: multipart/alternative; boundary="' + limite + '"');
  return cabeceras.join('\r\n') + '\r\n\r\n' +
    '--' + limite + '\r\n' +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    Buffer.from(String(m.body || ''), 'utf8').toString('base64') + '\r\n' +
    '--' + limite + '\r\n' +
    'Content-Type: text/html; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    Buffer.from(String(m.htmlBody), 'utf8').toString('base64') + '\r\n' +
    '--' + limite + '--';
}

async function enviar(m) {
  if (!m || !m.to || !String(m.to).trim()) {
    throw new Error('El correo no tiene destinatario.');
  }
  const api = await cliente();
  const crudo = Buffer.from(construirMensaje(m), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await api.users.messages.send({ userId: 'me', requestBody: { raw: crudo } });
}

// Manda todos los pendientes. NUNCA lanza: si un correo falla, se anota y se
// sigue con los demás — que uno no salga no puede impedir que salgan los otros,
// ni romper una operación que ya termino bien.
async function enviarPendientes(mensajes) {
  if (!mensajes || !mensajes.length) return { enviados: 0, fallidos: 0 };

  let enviados = 0, fallidos = 0;
  for (const m of mensajes) {
    try {
      await enviar(m);
      enviados++;
    } catch (err) {
      fallidos++;
      console.error('[correo] no se pudo enviar a ' + (m && m.to) + ': ' +
                    ((err && err.message) || err));
    }
  }
  return { enviados, fallidos };
}

module.exports = { enviar, enviarPendientes, construirMensaje, asuntoCodificado };
