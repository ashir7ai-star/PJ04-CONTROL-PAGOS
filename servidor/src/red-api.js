// Peticiones HTTP para `apps-script.gs`. Corre en el HILO TRABAJADOR.
//
// La lógica las hace de forma SÍNCRONA (`UrlFetchApp.fetch(...).getContentText()`),
// así que van por el mismo puente que Drive.
//
// El uso que importa es validar el token de Google al ingresar: sin esto, NADIE
// puede entrar. Se descubrió al conmutar, con el login roto en pantalla.

async function pedir(datos) {
  const opciones = datos.opciones || {};

  const r = await fetch(datos.url, {
    method:  opciones.method || 'get',
    headers: opciones.headers || {},
    body:    opciones.payload || undefined
  });

  return {
    codigo: r.status,
    texto:  await r.text()
  };
}

module.exports = { pedir };
