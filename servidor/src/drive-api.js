// Operaciones de Drive. Corre en el HILO TRABAJADOR, nunca en el principal.
//
// Acá todo es asíncrono y normal; quien lo vuelve síncrono para
// `apps-script.gs` es el puente.
//
// ⚠️ Una cuenta de servicio tiene su PROPIO Drive, separado del de una persona.
// Si no se le comparten las carpetas donde hoy viven los comprobantes, no las
// va a encontrar y va a crear otras nuevas en su propio espacio: los archivos
// se subirían bien, y nadie podría verlos jamás. Por eso `buscarCarpeta`
// distingue "no existe" de "no tengo acceso" y avisa distinto.

const { google } = require('googleapis');

// ─── Por qué Drive NO usa la cuenta de servicio ───────────────────────────
//
// Google ya no permite que una cuenta de servicio sea dueña de archivos en un
// Drive personal: "Service Accounts do not have storage quota". Puede buscar y
// organizar, pero no crear. Se comprobó en la práctica: encontró las 8
// carpetas sin problema y la subida falló.
//
// La salida es actuar EN NOMBRE de una persona, con una autorización que ella
// misma otorgó (ver `autorizar-drive.js`). Los comprobantes quedan en las
// mismas carpetas y con el mismo dueño que hoy.
//
// Las hojas SÍ siguen usando la cuenta de servicio: ahí no hay que crear
// archivos nuevos, solo leer y escribir en uno que ya existe.
function autorizacion() {
  const inline = process.env.DRIVE_TOKEN_JSON;
  if (inline && inline.trim()) {
    try { return JSON.parse(inline); }
    catch (err) { throw new Error('DRIVE_TOKEN_JSON no es un JSON válido.'); }
  }

  const ruta = process.env.DRIVE_TOKEN_ARCHIVO;
  if (ruta && ruta.trim()) {
    const path = require('path');
    return require(path.resolve(process.cwd(), ruta));
  }

  throw new Error(
    'Falta la autorización de Drive. Definí DRIVE_TOKEN_JSON (el contenido de ' +
    'token-drive.json) o DRIVE_TOKEN_ARCHIVO (la ruta al archivo). Se genera ' +
    'una sola vez con: node autorizar-drive.js'
  );
}

let clienteCache = null;

async function cliente() {
  if (clienteCache) return clienteCache;

  const t = autorizacion();
  if (!t.refresh_token) {
    throw new Error('La autorización de Drive no tiene refresh_token: hay que volver a generarla.');
  }

  const oAuth = new google.auth.OAuth2(t.client_id, t.client_secret);
  // El permiso duradero se canjea solo por accesos cortos cuando hacen falta.
  oAuth.setCredentials({ refresh_token: t.refresh_token });

  clienteCache = google.drive({ version: 'v3', auth: oAuth });
  return clienteCache;
}

// Busca una carpeta por nombre. Devuelve su id, o null si no existe.
async function buscarCarpeta(datos) {
  const api = await cliente();
  const nombre = String(datos.nombre || '').replace(/'/g, "\\'");

  const r = await api.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and name='" + nombre + "' and trashed=false",
    fields: 'files(id,name)',
    pageSize: 10,
    // Para que también encuentre carpetas en unidades compartidas, no solo en
    // el espacio propio de la cuenta de servicio.
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  const encontradas = r.data.files || [];
  return encontradas.length ? encontradas[0].id : null;
}

async function crearCarpeta(datos) {
  const api = await cliente();
  const cuerpo = {
    name: String(datos.nombre || 'Carpeta'),
    mimeType: 'application/vnd.google-apps.folder'
  };
  // Si se indicó una carpeta madre, la nueva queda adentro. Sin esto, todo
  // termina suelto en la raíz del Drive de la cuenta de servicio.
  if (datos.madre) cuerpo.parents = [datos.madre];

  const r = await api.files.create({
    requestBody: cuerpo,
    fields: 'id',
    supportsAllDrives: true
  });
  return r.data.id;
}

// Sube un archivo y devuelve su id y su URL.
async function subirArchivo(datos) {
  const api = await cliente();
  const { Readable } = require('stream');

  const contenido = Buffer.from(datos.base64 || '', 'base64');
  if (!contenido.length) throw new Error('El archivo llegó vacío: no se sube nada.');

  const r = await api.files.create({
    requestBody: {
      name: String(datos.nombre || 'archivo'),
      parents: datos.carpeta ? [datos.carpeta] : undefined
    },
    media: {
      mimeType: datos.tipo || 'application/octet-stream',
      body: Readable.from(contenido)
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true
  });

  return { id: r.data.id, url: r.data.webViewLink };
}

// Deja el archivo visible para cualquiera que tenga el enlace.
//
// Es lo que permite abrir el comprobante desde la app sin pedir permiso cada
// vez. No lo hace público en buscadores: hay que tener la dirección exacta.
async function compartirPorEnlace(datos) {
  const api = await cliente();
  await api.permissions.create({
    fileId: datos.id,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true
  });
  return true;
}

module.exports = { buscarCarpeta, crearCarpeta, subirArchivo, compartirPorEnlace };
