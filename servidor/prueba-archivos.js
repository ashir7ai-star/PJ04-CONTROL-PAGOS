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

console.log('\n=== El caso del 02/11: FileReader se niega y arrayBuffer no ===');
{
  // Un pantallazo de 192 KB falló al elegirlo Y al enviar. Si FileReader
  // falla, el segundo camino tiene que salvar el comprobante.
  const api = montar((r) => { r.error = { name: 'NotReadableError' }; r.onerror({ type: 'error' }); });
  const bytes = new TextEncoder().encode('ABC');   // base64: QUJD
  let llamadas = 0;
  const file = { name: 'Screenshot.jpg', type: 'image/jpeg', size: 3,
                 arrayBuffer: async () => { llamadas++; return bytes.buffer; } };
  let datos = null, fallo = null;
  try { datos = await api.leerArchivo(file); } catch (e) { fallo = e; }
  chk('se recupera por arrayBuffer', fallo === null, fallo && fallo.message);
  chk('sin esperar: la demora empeora este fallo', llamadas === 1, llamadas);
  chk('y el base64 es correcto', datos === 'QUJD', datos);
}

console.log('\n=== Un archivo grande no revienta al pasar a base64 ===');
{
  const api = montar((r) => { r.error = { name: 'NotReadableError' }; r.onerror({ type: 'error' }); });
  const grande = new Uint8Array(3 * 1024 * 1024).fill(65);
  const file = { name: 'grande.jpg', size: grande.length, arrayBuffer: async () => grande.buffer };
  let datos = null, fallo = null;
  try { datos = await api.leerArchivo(file); } catch (e) { fallo = e; }
  chk('3 MB se convierten sin error', fallo === null, fallo && fallo.message);
  chk('y sin perder bytes', datos && Buffer.from(datos, 'base64').length === grande.length, datos && datos.length);
}

console.log('\n=== Si fallan todos los caminos, el mensaje dice cuáles ===');
{
  const api = montar((r) => { r.error = { name: 'NotReadableError' }; r.onerror({ type: 'error' }); });
  const file = { name: 'roto.jpg', type: 'image/jpeg', size: 100,
                 arrayBuffer: async () => { const e = new Error('x'); e.name = 'NotFoundError'; throw e; } };
  let err = null;
  try { await api.leerArchivo(file); } catch (e) { err = e; }
  chk('nombra el archivo', err && /roto\.jpg/.test(err.message), err && err.message);
  chk('dice qué respondió el lector', err && /lector: NotReadableError/.test(err.message), err && err.message);
  chk('dice qué respondió arrayBuffer', err && /arrayBuffer: NotFoundError/.test(err.message), err && err.message);
  chk('dice el tipo de archivo', err && /image\/jpeg/.test(err.message), err && err.message);
  chk('y ofrece otro camino', err && /app Archivos/.test(err.message), err && err.message);
}

console.log('\n=== El aviso se va del todo, aunque sea largo ===');
{
  // 02/11: el mensaje de lectura ocupa varias líneas y, escondiéndose 110px
  // fijos, quedaba cortado al pie de la pantalla para siempre.
  const css = extraer('.toast {', '.toast.show');
  const oculto = (css.match(/transform:\s*translateX\(-50%\)\s*translateY\(([^;]*)\);/) || [])[1] || '';
  chk('se esconde según su propia altura, no con píxeles fijos',
      /^calc\(100%/.test(oculto), oculto);

  // El showToast real, con un reloj y un DOM de mentira.
  const pendientes = [];
  let vivo = null;
  const clases = new Set();
  const el = { classList: { remove: (c) => clases.delete(c) } };
  Object.defineProperty(el, 'className', { set: (v) => { clases.clear(); v.split(' ').forEach(c => clases.add(c)); } });
  const doc = { getElementById: () => el };
  const relojPoner = (fn, ms) => { const t = { fn, ms, cancelado: false }; pendientes.push(t); vivo = t; return t; };
  const relojQuitar = (t) => { if (t) t.cancelado = true; };
  const cuerpo = extraer('let temporizadorToast', '// ─── Envío');
  const showToast = new Function('document', 'setTimeout', 'clearTimeout', 'svgCheck', 'svgX',
    cuerpo + '\n; return showToast;')(doc, relojPoner, relojQuitar, '', '');

  showToast('error', 'Corto', 'Un aviso corto');
  chk('un aviso corto dura lo de siempre', vivo.ms === 4500, vivo.ms);
  const primero = vivo;

  showToast('error', 'Largo', 'x'.repeat(230));
  chk('uno largo dura más', vivo.ms > 10000, vivo.ms);
  chk('pero tiene un tope', vivo.ms <= 12000, vivo.ms);
  chk('el temporizador anterior queda cancelado', primero.cancelado === true, primero.cancelado);

  vivo.fn();
  chk('al vencer, el aviso se cierra', !clases.has('show'), Array.from(clases));
}

console.log('\n=== Un archivo vacío por arrayBuffer tampoco pasa como válido ===');
{
  const api = montar((r) => { r.error = { name: 'NotReadableError' }; r.onerror({ type: 'error' }); });
  const file = { name: 'vacio.jpg', size: 0, arrayBuffer: async () => new ArrayBuffer(0) };
  let err = null;
  try { await api.leerArchivo(file); } catch (e) { err = e; }
  chk('se rechaza', !!err, err);
}

console.log('\n=== El input NO se limpia antes de leer los archivos ===');
{
  // EL bug del 27/09, y lo rompi yo. `fileInput.files` es una lista VIVA y
  // `fileInput.value = ''` la vacia. Como addFiles paso a ser asincrono,
  // limpiarlo enseguida dejaba los archivos inservibles ANTES de leerlos: el
  // archivo no aparecia en la lista y no se podia registrar ningun pago.
  chk('la lista se copia antes de tocar el input',
      /const lista = Array\.from\(fileInput\.files\)/.test(html),
      'se sigue pasando la FileList viva');
  chk('el input se limpia DESPUES de leer',
      /await addFiles\(lista\);[\s\S]{0,40}fileInput\.value = ''/.test(html),
      'se limpia antes de terminar de leer');
  chk('nunca se limpia en la misma linea que addFiles',
      !/addFiles\(fileInput\.files\); fileInput\.value/.test(html),
      'volvio el limpiado inmediato');
}

console.log('\n=== Un fallo al elegir NO deja el archivo inservible ===');
{
  // La otra mitad: leer solo al elegir quitaba la red de seguridad. Si esa
  // lectura fallaba, el archivo quedaba muerto y el pago no salia. Ahora se
  // conserva la referencia y se reintenta al enviar.
  chk('se guarda la referencia al archivo', /file:\s+file,/.test(html), 'no se guarda el File');
  chk('archivos() reintenta leer lo que falte',
      /archivos: async \(\) => \{[\s\S]*?await leerArchivo\(f\.file\)/.test(html),
      'archivos() no reintenta');
  const esperan = (html.match(/const archivos = await upload\w+\.archivos\(\);/g) || []).length;
  chk('y los tres envios lo esperan', esperan === 3, esperan);
  chk('un archivo sin leer dice que falló y que se reintentará',
      /no se pudo leer, se reintentará al enviar/.test(html), 'falta el estado');
  chk('y se avisa al elegirlo, no al final del formulario',
      /n\.entrada\.error = [^\n]*\n\s*showToast\('error'/.test(html), 'no avisa al elegir');
  chk('volver a adjuntar un archivo fallido lo reemplaza',
      /if \(previo\.datos \|\| previo\.leyendo\) continue;\s*(\/\/[^\n]*\s*)*selectedFiles\.splice\(repetido, 1\)/.test(html),
      'el reintento se descarta como repetido');
}


console.log('\n=== Los archivos se leen al ELEGIRLOS, no al enviar ===');
{
  // El arreglo de fondo. Si algún día alguien vuelve a leer en el envío, el
  // problema del celular vuelve: entre elegir y enviar pasan minutos.
  chk('el envío de un pago pide los archivos al componente',
      /const archivos = await uploadNuevoPago\.archivos\(\);/.test(html), 'no los pide');
  chk('y se lee al agregar el archivo',
      /n\.entrada\.datos = await leerArchivo\(n\.file\)/.test(html), 'ya no se lee al elegir');
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);

})();
