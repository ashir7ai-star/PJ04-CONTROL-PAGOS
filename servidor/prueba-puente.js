// Pruebas del puente sincrono.
// Uso: node prueba-puente.js
//
// Lo que se verifica es lo mas dificil de todo el servidor: que una llamada
// asincrona devuelva su resultado a codigo que la espera de forma SINCRONA.
// Si esto falla mal, el servidor se cuelga entero.

const { llamar, detener } = require('./src/puente-sincrono');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

console.log('\n=== El puente devuelve el resultado, sin promesas ===');
{
  // La clave: esto NO es await. Es una llamada comun que devuelve el valor.
  const r = llamar('eco', { hola: 'mundo', n: 42 });
  chk('devuelve el valor directamente, no una promesa',
      r && typeof r.then !== 'function', typeof r);
  chk('y es el dato correcto', r.hola === 'mundo' && r.n === 42, r);

  chk('sirve para texto', llamar('eco', 'texto plano') === 'texto plano');
  chk('sirve para numeros', llamar('eco', 123) === 123);
  chk('sirve para arreglos', JSON.stringify(llamar('eco', [1, 2, 3])) === '[1,2,3]');
}

console.log('\n=== Espera de verdad a que termine ===');
{
  // Si no bloqueara, devolveria undefined antes de que el trabajo termine.
  const a = Date.now();
  const r = llamar('demora', { ms: 300 });
  const transcurrido = Date.now() - a;

  chk('esperó a que terminara', r === 'listo tras 300 ms', r);
  chk('y realmente bloqueó ~300 ms', transcurrido >= 290, transcurrido + ' ms');
}

console.log('\n=== Llamadas seguidas ===');
{
  // Cada llamada tiene que quedarse con SU resultado. Si se mezclaran, una
  // subida devolveria la URL de otro archivo — y nadie lo notaria.
  const uno  = llamar('eco', 'primero');
  const dos  = llamar('eco', 'segundo');
  const tres = llamar('eco', 'tercero');
  chk('cada llamada recibe lo suyo',
      uno === 'primero' && dos === 'segundo' && tres === 'tercero',
      [uno, dos, tres]);

  // Muchas seguidas, para descartar que el timbre quede desfasado.
  let bien = true;
  for (let i = 0; i < 25; i++) if (llamar('eco', i) !== i) bien = false;
  chk('25 llamadas seguidas sin desfase', bien);
}

console.log('\n=== Los errores llegan como errores ===');
{
  let explotó = false, mensaje = '';
  try { llamar('falla'); } catch (err) { explotó = true; mensaje = err.message; }
  chk('un fallo del otro hilo se convierte en excepcion aca', explotó);
  chk('y conserva el mensaje original', /falla a prop/.test(mensaje), mensaje);

  // Un mensaje generico no sirve cuando el problema real es un permiso de
  // Drive o una cuota agotada.
  let desconocida = false, m2 = '';
  try { llamar('operacion_que_no_existe'); } catch (err) { desconocida = true; m2 = err.message; }
  chk('una operacion inexistente falla en voz alta', desconocida);
  chk('y dice cual era', /operacion_que_no_existe/.test(m2), m2);

  // Y despues de un error, el puente tiene que seguir sirviendo.
  chk('el puente sobrevive al error', llamar('eco', 'sigo vivo') === 'sigo vivo');
}

detener();
console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
