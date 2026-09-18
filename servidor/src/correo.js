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

// El nombre que ve quien recibe el correo. Sin esto aparece el nombre
// personal de la cuenta ("Sandra Cardozo"), que confunde: el aviso lo manda
// el sistema, no una persona.
const NOMBRE_REMITENTE = process.env.CORREO_NOMBRE || 'Control de Pagos';

// La dirección sale de la cuenta autorizada, no de una variable: si mañana se
// autoriza otra cuenta, el remitente acompaña solo. Una variable aparte se
// desincronizaría en silencio y los correos saldrían diciendo una dirección
// que no es la que envía.
let direccionCache = null;
async function direccionPropia() {
  if (direccionCache) return direccionCache;

  // Si quedó guardada al autorizar, se usa esa y no se pregunta nada.
  const t = autorizacion();
  if (t.correo) { direccionCache = t.correo; return direccionCache; }

  // Se pregunta por DRIVE, no por Gmail: `gmail.send` solo permite enviar, no
  // leer el perfil — pedir un permiso más amplio solo para saber la propia
  // dirección sería pagar de más. El permiso de Drive ya lo tenemos y también
  // informa de qué cuenta se trata.
  const oAuth = new google.auth.OAuth2(t.client_id, t.client_secret);
  oAuth.setCredentials({ refresh_token: t.refresh_token });
  const drive = google.drive({ version: 'v3', auth: oAuth });
  const r = await drive.about.get({ fields: 'user(emailAddress)' });

  direccionCache = r.data.user.emailAddress;
  return direccionCache;
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
  const cabeceras = [];

  // El remitente va primero, como manda el formato. Si no se conoce la
  // dirección, se omite la cabecera y el servidor de correo pone la de la
  // cuenta: es preferible a inventar una que no exista.
  if (m.from) cabeceras.push('From: ' + asuntoCodificado(NOMBRE_REMITENTE) + ' <' + m.from + '>');

  cabeceras.push('To: ' + m.to);
  cabeceras.push('Subject: ' + asuntoCodificado(m.subject));
  cabeceras.push('MIME-Version: 1.0');

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

  let remitente = null;
  try {
    remitente = await direccionPropia();
  } catch (err) {
    // Si no se pudo averiguar, el correo sale igual con el remitente por
    // defecto. Perder el nombre visible es mucho menos grave que no avisar.
    console.warn('[correo] no se pudo leer la dirección propia: ' + err.message);
  }

  const crudo = Buffer.from(construirMensaje(Object.assign({}, m, { from: remitente })), 'utf8')
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

// Comprueba que la autorizacion sirva para enviar, SIN mandar ningun correo.
// Enviar uno de prueba en cada diagnostico llenaria de basura la bandeja.
async function permisos() {
  const t = autorizacion();
  const oAuth = new google.auth.OAuth2(t.client_id, t.client_secret);
  oAuth.setCredentials({ refresh_token: t.refresh_token });

  const at = await oAuth.getAccessToken();
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + at.token);
  const info = await r.json();
  const alcances = String(info.scope || '').split(' ');

  return {
    ok: alcances.some(a => a.indexOf('gmail.send') !== -1),
    puedeEnviar: alcances.some(a => a.indexOf('gmail.send') !== -1),
    // Se informa a proposito: si alguna vez aparece en 'si', el permiso es mas
    // amplio de lo que el sistema necesita y hay que volver a autorizar.
    puedeLeerCorreo: alcances.some(a => /gmail\.(readonly|modify)|mail\.google/.test(a))
  };
}

module.exports = { enviar, enviarPendientes, construirMensaje, asuntoCodificado, permisos, NOMBRE_REMITENTE };
