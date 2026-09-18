// El `DriveApp` que espera `apps-script.gs`, respaldado por la API de Drive.
//
// Se mantiene la MISMA forma que en Apps Script —un iterador con hasNext() y
// next(), un archivo con setSharing() y getUrl()— aunque por dentro sea otra
// cosa. La lógica de negocio no se toca: es toda la idea de la migración.
//
// Cada llamada cruza al hilo trabajador y bloquea hasta tener respuesta. Es
// lento comparado con leer memoria, pero subir un comprobante ya es lento de
// por sí y pasa pocas veces.

const { llamar } = require('./puente-sincrono');

// Carpeta madre opcional: si se define, todas las carpetas que se creen
// quedan adentro en vez de sueltas en la raíz del Drive de la cuenta de
// servicio, donde serían un desorden difícil de encontrar.
function carpetaMadre() {
  const id = process.env.DRIVE_CARPETA_MADRE;
  return id && id.trim() ? id.trim() : null;
}

function archivo(id, url) {
  return {
    getId:  () => id,
    getUrl: () => url,
    // En Apps Script devuelve el propio archivo para poder encadenar.
    setSharing: () => { llamar('compartirPorEnlace', { id: id }); return archivo(id, url); },
    setName: (n) => archivo(id, url),
    getName: () => ''
  };
}

function carpeta(id, nombre) {
  return {
    getId:   () => id,
    getName: () => nombre,
    getUrl:  () => 'https://drive.google.com/drive/folders/' + id,

    createFile: (blob) => {
      // El blob viene de Utilities.newBlob, que guardó los bytes tal cual.
      const datos = blob && blob.datos;
      const base64 = Buffer.isBuffer(datos)
        ? datos.toString('base64')
        : Buffer.from(datos || []).toString('base64');

      const r = llamar('subirArchivo', {
        carpeta: id,
        nombre:  (blob && blob.nombre) || 'archivo',
        tipo:    (blob && blob.tipo) || 'application/octet-stream',
        base64:  base64
      });
      return archivo(r.id, r.url);
    }
  };
}

function crearDriveApp() {
  return {
    // Apps Script devuelve un iterador perezoso. Acá la búsqueda ya se hizo,
    // pero se conserva la misma forma para no tocar la lógica.
    getFoldersByName: (nombre) => {
      const id = llamar('buscarCarpeta', { nombre: nombre });
      let entregada = false;
      return {
        hasNext: () => !!id && !entregada,
        next: () => {
          if (!id || entregada) throw new Error('No hay más carpetas con el nombre "' + nombre + '".');
          entregada = true;
          return carpeta(id, nombre);
        }
      };
    },

    createFolder: (nombre) => {
      const id = llamar('crearCarpeta', { nombre: nombre, madre: carpetaMadre() });
      return carpeta(id, nombre);
    },

    // Se usa solo en las funciones de mantenimiento, que se siguen corriendo
    // desde el editor de Apps Script. Si alguien la llama acá, mejor que lo
    // diga claro a que devuelva algo inservible.
    getFileById: () => {
      throw new Error(
        'DriveApp.getFileById no está disponible en el servidor propio. ' +
        'Las funciones de mantenimiento (respaldos, reparaciones) se siguen ' +
        'ejecutando desde el editor de Apps Script.'
      );
    },

    Access:     { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', ANYONE: 'ANYONE', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT', NONE: 'NONE' }
  };
}

module.exports = { crearDriveApp, carpeta, archivo };
