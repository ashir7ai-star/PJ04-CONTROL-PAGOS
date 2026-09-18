// El entorno que Apps Script le daba a `apps-script.gs`, reimplementado en Node.
//
// La lógica contable no se toca: se le cambia el piso. Este archivo arma los
// objetos globales que ese código espera encontrar (`SpreadsheetApp`,
// `Utilities`, `CacheService`, ...) y los respalda con la API de Sheets y con
// bibliotecas de Node.
//
// Lo que NO está todavía: `DriveApp` (subida de comprobantes) y `MailApp`
// (correos). Van en un paso siguiente. Hasta entonces se dejan como funciones
// que FALLAN de forma explícita: un adaptador que devuelve silencio haría que
// un comprobante no se suba y que nadie se entere.

const crypto = require('crypto');
const { crearLibro } = require('./adaptador-hojas');
const { crearDriveApp } = require('./adaptador-drive');

// ─── Utilities.formatDate ─────────────────────────────────────────────────
//
// Es la función más usada del archivo (22 llamadas) y la más delicada: de
// acá salió el problema de día/mes que costó una jornada entera. Se
// implementan SOLO los siete patrones que el código realmente usa, y
// cualquier otro falla en voz alta en vez de devolver algo aproximado.
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function partesEnZona(fecha, zona) {
  // Intl es lo que traduce un instante a la hora de pared de una zona, que es
  // exactamente lo que hacía Utilities.formatDate. Hacerlo a mano con
  // getHours() daría la hora del servidor, que en EasyPanel es UTC — y todas
  // las fechas saldrían corridas cinco horas.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const p = {};
  fmt.formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  // 'en-CA' con hour12:false devuelve 24 para la medianoche en algunos Node.
  if (p.hour === '24') p.hour = '00';
  return p;
}

function formatDate(fecha, zona, patron) {
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) {
    throw new Error('Utilities.formatDate recibió algo que no es una fecha válida.');
  }
  const p = partesEnZona(fecha, zona || 'America/Bogota');

  switch (patron) {
    case 'yyyy-MM-dd HH:mm':  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
    case 'yyyy-MM-dd HH.mm':  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + '.' + p.minute;
    case 'yyyy-MM-dd':        return p.year + '-' + p.month + '-' + p.day;
    case 'yyyy-MM':           return p.year + '-' + p.month;
    case 'dd/MM/yyyy HH:mm':  return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
    case 'dd/MM/yyyy':        return p.day + '/' + p.month + '/' + p.year;
    case 'MMMM yyyy':         return MESES_ES[Number(p.month) - 1] + ' ' + p.year;
    default:
      // Inventar un formato parecido sería peor: una fecha mal formateada no
      // da error, da un dato equivocado en la contabilidad.
      throw new Error('Utilities.formatDate: patrón no contemplado: "' + patron + '"');
  }
}

// ─── Caché ────────────────────────────────────────────────────────────────
// En memoria del proceso por ahora. Cuando el servicio esté en pie se cambia
// por `redis`, que ya corre en el mismo proyecto de EasyPanel: así sobrevive a
// un reinicio y sirve igual si algún día hay más de una instancia.
function crearCache() {
  const datos = new Map();
  return {
    get(clave) {
      const e = datos.get(clave);
      if (!e) return null;
      if (e.vence && e.vence < Date.now()) { datos.delete(clave); return null; }
      return e.valor;
    },
    put(clave, valor, segundos) {
      datos.set(clave, { valor: String(valor), vence: segundos ? Date.now() + segundos * 1000 : 0 });
    },
    remove(clave) { datos.delete(clave); }
  };
}

const cacheCompartido = crearCache();

// ─── Armado del entorno ───────────────────────────────────────────────────
//
// `foto` son las hojas ya leídas. `registro` recibe lo que el código mande a
// Logger.log, para poder verlo en los registros del servidor.
function crearEntorno(foto, opciones) {
  const op    = opciones || {};
  const zona  = op.zona || process.env.ZONA_HORARIA || 'America/Bogota';
  const libro = crearLibro(foto);
  const bitacora = [];
  const correos  = [];

  // Para las pruebas: permite armar el entorno SIN Drive y verificar que la
  // lógica que no lo necesita funcione igual.
  const noDisponible = (que) => {
    const explota = () => {
      throw new Error(
        que + ' no está disponible en este entorno. ' +
        'Esta acción hay que seguir haciéndola por Apps Script.'
      );
    };
    return { getFileById: explota, getFoldersByName: explota, createFolder: explota,
             Access: {}, Permission: {}, sendEmail: explota, fetch: explota };
  };

  const entorno = {
    SpreadsheetApp: libro.SpreadsheetApp,

    Utilities: {
      formatDate: formatDate,
      getUuid: () => crypto.randomUUID(),
      computeDigest: (algoritmo, texto) => {
        // Apps Script devuelve un arreglo de bytes CON SIGNO (-128..127). El
        // código lo convierte a hexadecimal contando con eso; devolver bytes
        // sin signo cambiaría todos los hashes y dejaría afuera a todas las
        // sesiones abiertas.
        const buf = crypto.createHash('sha256').update(String(texto), 'utf8').digest();
        return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Encode: (x) => Buffer.from(String(x), 'utf8').toString('base64'),
      // Devuelve un Buffer y no un arreglo de bytes: es lo que después sube a
      // Drive sin pasos intermedios. Nada en la lógica recorre estos bytes;
      // solo se los entrega a newBlob.
      base64Decode: (x) => Buffer.from(String(x), 'base64'),
      newBlob: (datos, tipo, nombre) => ({ datos, tipo, nombre })
    },

    Logger: { log: (m) => { bitacora.push(String(m)); if (op.verboso) console.log(m); } },

    Session: { getScriptTimeZone: () => zona },

    CacheService: {
      getScriptCache: () => cacheCompartido,
      getUserCache:   () => cacheCompartido
    },

    // La respuesta ya no viaja por ContentService: el servidor HTTP la manda
    // directo. Se conserva el objeto porque el código lo usa, y se guarda el
    // texto para que el servidor lo tome.
    ContentService: {
      createTextOutput: (texto) => ({
        setMimeType: () => ({ _json: texto }),
        _json: texto
      }),
      MimeType: { JSON: 'application/json' }
    },

    // Drive de verdad. Las llamadas cruzan al hilo trabajador y vuelven
    // resueltas, así la lógica las usa igual que en Apps Script.
    DriveApp: op.sinDrive ? noDisponible('DriveApp') : crearDriveApp(),
    MailApp:     { sendEmail: (m) => { correos.push(m); } },
    UrlFetchApp: noDisponible('UrlFetchApp'),
    ScriptApp:   noDisponible('ScriptApp.getOAuthToken'),

    console: console,
    Date: Date,
    JSON: JSON,
    Math: Math
  };

  return {
    globales: entorno,
    cambios:  libro.cambios,
    datos:    libro.datos,
    bitacora: () => bitacora.slice(),
    correos:  () => correos.slice()
  };
}

module.exports = { crearEntorno, formatDate, crearCache };
