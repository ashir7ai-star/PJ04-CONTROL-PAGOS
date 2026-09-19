// Qué se le muestra al usuario cuando algo falla.
//
// ─── Por qué esto existe ──────────────────────────────────────────────────
//
// El 18/09/2026 una usuaria vio esto en la pantalla de ingreso:
//
//   "Quota exceeded for quota metric 'Read requests' and limit 'Read requests
//    per minute per user' of service 'sheets.googleapis.com' for consumer
//    'project_number:165996240052'."
//
// En inglés, con el número de proyecto adentro, y sin decirle qué hacer. Ese
// texto no lo escribimos nosotros: se escapó tal cual desde la biblioteca de
// Google porque el servidor devolvía `err.message` sin mirarlo.
//
// Acá se decide, en un solo lugar y sin depender de que el error venga
// marcado. Vive aparte del servidor para poder probarlo: `servidor.js` levanta
// un puerto al importarlo, así que lo que esté adentro no se puede probar sin
// arrancar el servicio.

// ⚠️ El código del error NO está siempre en el mismo lugar. En gaxios 6 (la
// versión instalada) un 429 llega como `err.status` y `err.code` queda SIN
// DEFINIR — solo se llena si el error de abajo traía uno propio. Encadenarlos
// con `||` tampoco alcanza: se corta con el primer valor no vacío, aunque sea
// un texto como 'ERR_BAD_REQUEST', y nunca llega a mirar el status.
function codigoHttpDe(err) {
  if (!err) return null;
  const candidatos = [
    err.status,
    err.code,
    err.response && err.response.status,
    err.errors && err.errors[0] && err.errors[0].reason
  ];
  for (const c of candidatos) {
    if (Number.isFinite(Number(c)) && String(c).trim() !== '') return Number(c);
  }
  return null;
}

const TEXTO_DE_CUOTA = /quota exceeded|rateLimitExceeded|userRateLimitExceeded/i;
// Cualquier cosa que delate que el mensaje lo escribió Google y no nosotros.
const TEXTO_DE_GOOGLE = /googleapis\.com|accounts\.google\.com|oauth2|invalid_grant|invalid_token/i;

const MENSAJE_CUOTA =
  'El sistema está recibiendo muchas consultas en este momento. ' +
  'Esperá unos segundos y volvé a intentar.';

// Devuelve { http, codigo, message } — lo que hay que responder.
//
// `message` es SIEMPRE algo que una persona puede leer y accionar. El detalle
// técnico se devuelve aparte, en `registro`, para que quede en los logs del
// servidor y no en la pantalla.
function traducirError(err) {
  const crudo = String((err && err.message) || '');

  // 1. Cuota agotada. Puede venir marcada desde hojas.js, o por código, o solo
  //    por el texto si se escapó de algún lado que no pasa por ahí.
  if ((err && err.cuota) || codigoHttpDe(err) === 429 || TEXTO_DE_CUOTA.test(crudo)) {
    return {
      http: 503,
      codigo: 'CUOTA',
      // El mensaje propio de hojas.js/foto.js es más preciso (aclara si se
      // registró algo o no), así que se prefiere cuando existe.
      message: (err && err.cuota && crudo) ? crudo : MENSAJE_CUOTA,
      registro: crudo
    };
  }

  // 2. Cualquier otro mensaje que sea de Google. No se muestra crudo.
  if (TEXTO_DE_GOOGLE.test(crudo)) {
    return {
      http: 502,
      codigo: 'GOOGLE',
      message: 'Google no respondió como se esperaba. Volvé a intentar en un momento.',
      registro: crudo
    };
  }

  // 3. Lo nuestro sí se muestra: esos mensajes los escribimos para que sirvan.
  return {
    http: 500,
    codigo: 'ERROR',
    message: crudo || 'Error inesperado en el servidor.',
    registro: crudo
  };
}

module.exports = { traducirError, codigoHttpDe, MENSAJE_CUOTA };
