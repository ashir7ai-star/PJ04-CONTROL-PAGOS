// Pruebas de la lectura de archivos adjuntos (lo que corre en el navegador).
// Uso: node prueba-archivos.js
//
// ─── De dónde sale esta suite ─────────────────────────────────────────────
//
// Varias veces, al subir un pago desde el celular, aparecía:
//
//   "No pudimos confirmar el envío — Error desconocido. Intentá de nuevo."
//
// El servidor no registraba ningún error: la petición nunca llegaba. La causa
// era `reader.onerror = reject`, que parece correcto y no lo es: onerror
// entrega un **ProgressEvent**, no un Error. Un evento no tiene `.message`, así
// que el mensaje quedaba en "Error desconocido" y tapaba la causa real.
//
// Y la causa real era que el archivo ya no estaba: en Android una foto de la
// galería es un archivo temporal que el sistema puede reclamar entre que se
// elige y que se envía el pago.

const fs = require('fs');
const path = require('path');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

// Se extraen las funciones reales de index.html: lo que se prueba es el código
// que corre en el celular, no una copia.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extraer(nombre, hasta) {
  const i = html.indexOf(nombre);
  if (i === -1) throw new Error('No se encontró ' + nombre + ' en index.html');
  const j = html.indexOf(hasta, i);
  return html.slice(i, j);
}

const fuente =
  extraer('function fileToBase64', '// ─── Vista restringida') +
  '\n; return { fileToBase64: fileToBase64, leerArchivo: leerArchivo, mensajeDeError: mensajeDeError };';

const mensajeFuente = extraer('function mensajeDeError', '\n    // Traduce una respuesta');

// El navegador de mentira: FileReader y navigator, que en Node no existen.
function montar(comportamiento) {
  const ctx = {
    navigator: { onLine: true },
    setTimeout: setTimeout,
    FileReader: function () {
      this.readAsDataURL = (file) => {
        setTimeout(() => comportamiento(this, file), 0);
      };
    }
  };
  const fn = new Function('navigator', 'FileReader', 'setTimeout',
    mensajeFuente + '\n' + fuente);
  return fn(ctx.navigator, ctx.FileReader, ctx.setTimeout);
}

(async () => {

console.log('\n=== Un archivo que se lee bien ===');
{
  const api = montar((r) => { r.result = 'data:image/jpeg;base64,QUJD'; r.onload(); });
  const datos = await api.fileToBase64({ name: 'foto.jpg', size: 100 });
  chk('devuelve solo el base64, sin el encabezado', datos === 'QUJD', datos);
}

console.log('\n=== El caso real: el archivo ya no está ===');
{
  // Esto es exactamente lo que hacía el navegador: llamar a onerror con un
  // evento. Antes se hacía `reject(evento)` y el usuario veía "Error desconocido".
  const api = montar((r) => {
    r.error = { name: 'NotFoundError', message: '' };
    r.onerror({ type: 'error' });          // un ProgressEvent, no un Error
  });

  let err = null;
  try { await api.fileToBase64({ name: 'Screenshot_20260927.jpg', size: 193000 }); }
  catch (e) { err = e; }

  chk('lo que llega es un Error de verdad', err instanceof Error, String(err));
  chk('y TIENE mensaje', !!(err && err.message), err && err.message);
  chk('dice QUÉ archivo falló', /Screenshot_20260927\.jpg/.test(err.message), err.message);
  chk('dice el motivo que dio el navegador', /NotFoundError/.test(err.message), err.message);
  chk('y dice qué hacer', /volvé a adjuntarlo/i.test(err.message), err.message);

  // Lo que el usuario ve. Esto es lo que estuvo roto.
  chk('el mensaje al usuario YA NO es "Error desconocido"',
      !/Error desconocido/.test(api.mensajeDeError(err)), api.mensajeDeError(err));
}

console.log('\n=== Y si algo falla sin mensaje, igual se dice algo útil ===');
{
  const api = montar((r) => { r.result = 'data:,'; r.onload(); });
  // Un ProgressEvent pelado, como el que llegaba antes.
  const evento = { type: 'error' };
  const m = api.mensajeDeError(evento);
  chk('no se queda en "Error desconocido" a secas', !/^Error desconocido/.test(m), m);
  chk('y deja una pista de qué llegó', /evento "error"/.test(m), m);
}

console.log('\n=== Un archivo vacío no pasa como válido ===');
{
  const api = montar((r) => { r.result = ''; r.onload(); });
  let err = null;
  try { await api.fileToBase64({ name: 'vacio.pdf', size: 0 }); } catch (e) { err = e; }
  chk('se rechaza', !!err, err);
  chk('y lo dice', /vac[ií]o/i.test(err.message), err && err.message);
}

console.log('\n=== El reintento: falla la primera, anda la segunda ===');
{
  let intentos = 0;
  const api = montar((r) => {
    intentos++;
    if (intentos === 1) { r.error = { name: 'NotReadableError' }; r.onerror({ type: 'error' }); return; }
    r.result = 'data:image/jpeg;base64,T0s='; r.onload();
  });
  let datos = null, fallo = null;
  try { datos = await api.leerArchivo({ name: 'foto.jpg', size: 100 }); }
  catch (e) { fallo = e; }
  chk('no se rinde en el primer fallo', fallo === null, fallo && fallo.message);
  chk('se reintenta una vez', intentos === 2, intentos);
  chk('y termina leyendo bien', datos === 'T0s=', datos);
}

console.log('\n=== Si falla siempre, se rinde con un mensaje claro ===');
{
  let intentos = 0;
  const api = montar((r) => { intentos++; r.error = { name: 'NotReadableError' }; r.onerror({ type: 'error' }); });
  let err = null;
  try { await api.leerArchivo({ name: 'roto.jpg', size: 100 }); } catch (e) { err = e; }
  chk('lo intenta dos veces y para', intentos === 2, intentos);
  chk('y el mensaje sirve', err && /roto\.jpg/.test(err.message), err && err.message);
}

console.log('\n=== Los archivos se leen al ELEGIRLOS, no al enviar ===');
{
  // El arreglo de fondo. Si algún día alguien vuelve a leer en el envío, el
  // problema del celular vuelve: entre elegir y enviar pasan minutos.
  chk('el envío de un pago usa los bytes ya leídos',
      /const archivos = uploadNuevoPago\.archivos\(\);/.test(html), 'volvió a leer al enviar');
  chk('el de una solicitud también',
      /const archivos = uploadSolicitud\.archivos\(\);/.test(html), 'volvió a leer al enviar');
  chk('y el de un traslado también',
      /const archivos = uploadTraslado\.archivos\(\);/.test(html), 'volvió a leer al enviar');
  chk('no queda ningún fileToBase64 en los envíos',
      !/datos:\s*await fileToBase64/.test(html), 'quedó una lectura en el envío');
  chk('y se lee al agregar el archivo',
      /n\.entrada\.datos = await leerArchivo\(n\.file\)/.test(html), 'ya no se lee al elegir');
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);

})();
