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

// Nombres de todas las pestañas del documento, sin leer su contenido.
async function nombresDeHojas(soloLectura) {
  const api = await cliente(soloLectura);
  const r = await api.spreadsheets.get({
    spreadsheetId: idDocumento(),
    fields: 'sheets.properties.title'   // solo los títulos: la respuesta es mínima
  });
  return (r.data.sheets || []).map(h => h.properties.title);
}

// Lee varias hojas completas en UNA sola llamada.
//
// Devuelve { 'NOMBRE': [[fila], [fila], ...] }. Las fechas vuelven como texto
// en formato ISO (yyyy-MM-dd HH:mm:ss) gracias a FORMATTED_VALUE + el formato
// del documento; para el cálculo se convierten a Date en la capa de dominio.
async function leerHojas(nombres, soloLectura) {
  const api = await cliente(soloLectura);
  const r = await api.spreadsheets.values.batchGet({
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
  });

  const salida = {};
  (r.data.valueRanges || []).forEach((rango, i) => {
    salida[nombres[i]] = rango.values || [];
  });
  return salida;
}

module.exports = { nombresDeHojas, leerHojas, idDocumento };
