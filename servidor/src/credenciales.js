// Las credenciales de la cuenta de servicio, tomadas del entorno.
//
// NUNCA se escriben en el código: el repositorio es público (sirve la app por
// GitHub Pages), y una clave subida ahí da acceso de escritura a la
// contabilidad — y queda en el historial de git aunque después se borre.
//
// Se aceptan dos formas porque los hosts difieren: EasyPanel es más cómodo con
// el JSON pegado en una variable, y en local con un archivo.

const path = require('path');

function credenciales() {
  const inline = process.env.GOOGLE_CREDENCIALES_JSON;
  if (inline && inline.trim()) {
    try {
      return JSON.parse(inline);
    } catch (err) {
      throw new Error(
        'GOOGLE_CREDENCIALES_JSON no es un JSON válido. Si lo pegaste en el ' +
        'panel, revisá que esté completo y en una sola variable.'
      );
    }
  }

  const ruta = process.env.GOOGLE_CREDENCIALES_ARCHIVO;
  if (ruta && ruta.trim()) return require(path.resolve(process.cwd(), ruta));

  throw new Error(
    'Faltan las credenciales. Definí GOOGLE_CREDENCIALES_JSON (el contenido ' +
    'del archivo) o GOOGLE_CREDENCIALES_ARCHIVO (la ruta al archivo).'
  );
}

function idDocumento() {
  const id = process.env.SHEETS_ID;
  if (!id || !id.trim()) {
    throw new Error('Falta SHEETS_ID: el identificador del documento de Google Sheets.');
  }
  return id.trim();
}

module.exports = { credenciales, idDocumento };
