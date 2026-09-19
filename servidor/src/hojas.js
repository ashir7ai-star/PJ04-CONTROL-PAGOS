// Acceso a las hojas de cálculo.
//
// La diferencia de fondo con Apps Script está acá: `values.batchGet` trae
// TODAS las hojas en UNA sola llamada HTTP. Apps Script obligaba a un
// `getDataRange().getValues()` por hoja, y cada uno costó entre 200 ms y
// 2.085 ms medidos contra este mismo documento — once hojas, once viajes.
//
// Las credenciales NUNCA se escriben en el código. Salen del entorno, que es
// lo que permite que el repositorio sea público sin exponer la contabilidad.

const { google } = require('googleapis');

const ALCANCE_LECTURA  = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const ALCANCE_ESCRITURA = 'https://www.googleapis.com/auth/spreadsheets';

const { credenciales, idDocumento } = require('./credenciales');
const cupo = require('./cupo-lecturas');

// ─── Reintentos: apagados para el 429 ─────────────────────────────────────
//
// La biblioteca de Google reintenta sola hasta 3 veces, y su lista de códigos
// a reintentar incluye el 429 (cuota agotada). Eso convierte UNA lectura
// rechazada en CUATRO peticiones — justo cuando no queda cupo.
//
// Reintentar un 429 no es esperar a que se libere la cuota: es gastar el cupo
// que hace falta para que se libere. Por eso acá el 429 se deja pasar hacia
// arriba en el acto, y quien llama decide (servir lo último leído, o avisar).
// Los errores 5xx sí se reintentan: ahí el problema es del otro lado y volver
// a intentar es lo correcto.
const REINTENTOS = {
  retryConfig: {
    retry: 2,
    statusCodesToRetry: [[500, 599]]
  }
};

// Traduce el error de cuota a algo que se pueda mostrar. El mensaje de Google
// ("Quota exceeded for quota metric 'Read requests'...") apareció tal cual en
// la pantalla de una usuaria: en inglés, con el número de proyecto adentro, y
// sin decirle qué hacer.
// ⚠️ El código del error viene en lugares distintos según la versión de la
// biblioteca. En gaxios 6 el 429 llega como `err.status` y `err.code` queda
// SIN DEFINIR (solo se llena si el error de abajo traía uno propio); en otras
// versiones es `err.code`. Mirar uno solo —o encadenarlos con `||`, que se
// corta con el primer valor no vacío aunque sea un texto como
// 'ERR_BAD_REQUEST'— deja pasar el error sin traducir, y el texto de Google
// termina en la pantalla de un usuario. Ya pasó.
//
// Por eso se miran los cuatro lugares, y como última red, el texto.
function esDeCuota(err) {
  if (!err) return false;

  const candidatos = [
    err.status,
    err.code,
    err.response && err.response.status,
    err.errors && err.errors[0] && err.errors[0].reason
  ];
  if (candidatos.some(c => Number(c) === 429)) return true;

  return /quota exceeded|rateLimitExceeded|userRateLimitExceeded/i.test(String(err.message || ''));
}

function comoErrorDeCuota(err) {
  const e = new Error(
    'El sistema está recibiendo muchas consultas en este momento. ' +
    'Esperá unos segundos y volvé a intentar.'
  );
  e.cuota = true;
  e.original = err && err.message;
  return e;
}

let clienteCache = null;

async function cliente(soloLectura) {
  if (clienteCache) return clienteCache;
  const cred = credenciales();
  const auth = new google.auth.GoogleAuth({
    credentials: cred,
    scopes: [soloLectura ? ALCANCE_LECTURA : ALCANCE_ESCRITURA]
  });
  clienteCache = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return clienteCache;
}

// ─── Los nombres de las pestañas casi nunca cambian ───────────────────────
//
// Esta llamada costaba una lectura ENTERA de cuota cada vez que se traía la
// foto, o sea el DOBLE de lo necesario: una para preguntar cómo se llaman las
// pestañas y otra para leerlas. Y la respuesta es siempre la misma: las
// pestañas solo cambian cuando alguien crea una hoja.
//
// Guardarla es la mitad del consumo, de un plumazo. Se invalida desde el
// servidor cuando la lógica crea una pestaña (`olvidarNombres`), así que el
// caso que importa está cubierto; el vencimiento por tiempo es la red de
// seguridad para una pestaña creada a mano en el documento.
const MINUTOS_NOMBRES = Number(process.env.MINUTOS_NOMBRES || 10);
let nombresCache = null;

function olvidarNombres() { nombresCache = null; }

// Nombres de todas las pestañas del documento, sin leer su contenido.
async function nombresDeHojas(soloLectura, forzar) {
  if (!forzar && nombresCache && nombresCache.vence > Date.now()) {
    return nombresCache.nombres.slice();
  }

  const api = await cliente(soloLectura);
  cupo.anotar();
  let r;
  try {
    r = await api.spreadsheets.get({
      spreadsheetId: idDocumento(),
      fields: 'sheets.properties.title'   // solo los títulos: la respuesta es mínima
    }, REINTENTOS);
  } catch (err) {
    // Si no quedaba cupo pero SÍ tenemos nombres guardados, sirven: una
    // pestaña nueva es mucho menos probable que un pico de consultas.
    if (esDeCuota(err) && nombresCache) return nombresCache.nombres.slice();
    throw esDeCuota(err) ? comoErrorDeCuota(err) : err;
  }

  const nombres = (r.data.sheets || []).map(h => h.properties.title);
  nombresCache = { nombres: nombres, vence: Date.now() + MINUTOS_NOMBRES * 60000 };
  return nombres.slice();
}

// Lee varias hojas completas en UNA sola llamada.
//
// Devuelve { 'NOMBRE': [[fila], [fila], ...] }. Las fechas vuelven como texto
// en formato ISO (yyyy-MM-dd HH:mm:ss) gracias a FORMATTED_VALUE + el formato
// del documento; para el cálculo se convierten a Date en la capa de dominio.
async function leerHojas(nombres, soloLectura) {
  const api = await cliente(soloLectura);
  cupo.anotar();
  let r;
  try {
    r = await api.spreadsheets.values.batchGet({
      spreadsheetId: idDocumento(),
      // Comillas simples alrededor del nombre: sin eso, una pestaña con espacios
      // ("Caja Menor") rompe el rango y la llamada falla entera.
      ranges: nombres.map(n => "'" + n.replace(/'/g, "''") + "'"),
      // UNFORMATTED_VALUE devuelve los números como números (no "$ 1.000") y las
      // fechas como número de serie; SERIAL_NUMBER las hace convertibles sin
      // depender del idioma del documento, que fue justo el origen del problema
      // de día/mes que costó una jornada entera.
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    }, REINTENTOS);
  } catch (err) {
    throw esDeCuota(err) ? comoErrorDeCuota(err) : err;
  }

  const salida = {};
  (r.data.valueRanges || []).forEach((rango, i) => {
    salida[nombres[i]] = rango.values || [];
  });
  return salida;
}

module.exports = { nombresDeHojas, leerHojas, idDocumento, olvidarNombres, esDeCuota };
