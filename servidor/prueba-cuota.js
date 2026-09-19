// Pruebas del consumo de cuota de lectura y de la foto de las hojas.
// Uso: node prueba-cuota.js
//
// ─── De dónde sale esta suite ─────────────────────────────────────────────
//
// El 18/09/2026 la app dejó de funcionar para Sandra con este mensaje en
// pantalla, en inglés:
//
//   "Quota exceeded for quota metric 'Read requests' and limit 'Read requests
//    per minute per user' of service 'sheets.googleapis.com' for consumer
//    'project_number:165996240052'."
//
// Google permite 60 lecturas por minuto "por usuario", y con una cuenta de
// servicio ese usuario es UNO SOLO para toda la empresa: los nueve comparten
// el mismo balde. Nathan estaba probando al mismo tiempo.
//
// Nada de esto falla en una prueba manual: falla cuando hay dos personas a la
// vez, que es justo lo que nadie prueba a mano.

const cupo = require('./src/cupo-lecturas');
const { crearGestorDeFoto } = require('./src/foto');
const { ACCIONES_QUE_EXIGEN_FRESCO } = (() => {
  // servidor.js levanta el puerto al importarlo, así que la lista se lee del
  // archivo en vez de requerirlo. Lo que importa es QUÉ acciones están.
  const texto = require('fs').readFileSync(require('path').join(__dirname, 'src', 'servidor.js'), 'utf8');
  const bloque = texto.split('const ACCIONES_QUE_EXIGEN_FRESCO = [')[1].split('];')[0];
  return { ACCIONES_QUE_EXIGEN_FRESCO: (bloque.match(/'[a-z_]+'/g) || []).map(s => s.slice(1, -1)) };
})();

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

// Un cupo de mentira, para poder decidir en la prueba si hay lugar o no.
function cupoFalso(hay) {
  return {
    disponible: hay,
    rechazos: 0,
    hayCupo() { return this.disponible; },
    msHastaCupo() { return 30; },
    anotarRechazo() { this.rechazos++; }
  };
}

// Un gestor con lecturas contadas. `filas` es lo que devuelve la hoja.
function gestor(op) {
  const estado = { lecturas: 0, valor: [['A'], ['1']] };
  const g = crearGestorDeFoto(Object.assign({
    leerNombres: async () => { return ['H']; },
    leerHojas:   async () => { estado.lecturas++; return { H: estado.valor }; },
    convertir:   (crudo) => crudo,
    dormir:      async () => {}
  }, op || {}));
  g._estado = estado;
  return g;
}

(async () => {

console.log('\n=== El freno: una ventana deslizante de 60 s ===');
{
  cupo.reiniciar();
  chk('recién arrancado hay cupo', cupo.hayCupo());
  chk('y no hay espera', cupo.msHastaCupo() === 0, cupo.msHastaCupo());

  for (let i = 0; i < cupo.LIMITE; i++) cupo.anotar();

  chk('al llegar al límite propio se corta', !cupo.hayCupo(), cupo.usadas());
  chk('el límite propio queda POR DEBAJO del de Google',
      cupo.LIMITE < 60, cupo.LIMITE);
  chk('dice cuánto falta para que se libere un lugar',
      cupo.msHastaCupo() > 0 && cupo.msHastaCupo() <= 60100, cupo.msHastaCupo());

  const r = cupo.resumen();
  chk('el resumen cuenta lo del último minuto', r.enElUltimoMinuto === cupo.LIMITE, r);
  chk('y el total desde el arranque', r.desdeElArranque === cupo.LIMITE, r);
  cupo.reiniciar();
}

console.log('\n=== La foto guardada evita lecturas repetidas ===');
{
  const g = gestor({ cupo: cupoFalso(true), segundos: 60 });

  await g.traer(false);
  await g.traer(false);
  await g.traer(false);
  chk('tres consultas seguidas = UNA sola lectura', g._estado.lecturas === 1, g._estado.lecturas);

  // Una acción que decide sobre el estado no se sirve de la foto.
  await g.traer(true);
  chk('una acción que exige estado real sí vuelve a leer', g._estado.lecturas === 2, g._estado.lecturas);
}

console.log('\n=== Dos personas a la vez no leen dos veces ===');
{
  // Esto es exactamente lo que pasó: Nathan y Sandra usando la app al mismo
  // tiempo. Sin compartir la lectura, cada apertura simultánea gastaba cuota
  // por separado.
  let resolver;
  const g = gestor({
    cupo: cupoFalso(true), segundos: 60,
    leerHojas: () => new Promise(r => { resolver = () => r({ H: [['A']] }); })
  });

  const a = g.traer(false);
  const b = g.traer(false);
  const c = g.traer(false);
  await new Promise(r => setTimeout(r, 0));   // que la lectura llegue a arrancar
  resolver();
  const [ra, rb, rc] = await Promise.all([a, b, c]);

  chk('las tres reciben la misma foto', ra.foto === rb.foto && rb.foto === rc.foto);
  chk('las tres llegan con datos', !!ra.foto.H && !!rc.foto.H);
}

console.log('\n=== Sin cuota: una consulta se sirve, una escritura NO ===');
{
  // La foto tiene que estar VENCIDA: si sigue viva se sirve sin mirar el cupo,
  // que es lo correcto pero no es lo que se quiere probar acá.
  const sinCupo = cupoFalso(true);
  const g = gestor({ cupo: sinCupo, segundos: 0.02 });

  await g.traer(false);              // deja algo guardado
  await new Promise(r => setTimeout(r, 40));
  const antes = g._estado.lecturas;
  sinCupo.disponible = false;

  const r = await g.traer(false);
  chk('una consulta recibe lo último leído', !!r.foto, r);
  chk('marcada como vencida, no se hace pasar por fresca', r.vencida === true, r);
  chk('y no gastó una lectura', g._estado.lecturas === antes, g._estado.lecturas);
  chk('quedó registrado que no había cupo', sinCupo.rechazos === 1, sinCupo.rechazos);

  // Lo que NO puede pasar: registrar un pago sobre una foto vencida. Así es
  // exactamente como se duplica un pago.
  let error = null;
  try { await g.traer(true); } catch (err) { error = err; }
  chk('una acción que decide se rehúsa a usar datos viejos', !!error);
  chk('y lo dice en castellano', error && /muchas consultas/.test(error.message), error && error.message);
  chk('y aclara que no se registró nada', error && /No se registró nada/.test(error.message), error && error.message);
  chk('el error viene marcado como de cuota', error && error.cuota === true);
}

console.log('\n=== Un 429 de Google no deja al usuario sin nada ===');
{
  let falla = false;
  const g = gestor({
    cupo: cupoFalso(true), segundos: 0.001,
    leerHojas: async () => {
      if (falla) { const e = new Error('Quota exceeded'); e.cuota = true; throw e; }
      return { H: [['viejo']] };
    }
  });

  await g.traer(false);
  await new Promise(r => setTimeout(r, 20));   // que venza
  falla = true;

  const r = await g.traer(false);
  chk('la consulta se sirve con lo anterior', r.foto.H[0][0] === 'viejo', r.foto);
  chk('y avisa que está vencida', r.vencida === true, r);

  let error = null;
  try { await g.traer(true); } catch (err) { error = err; }
  chk('una acción que decide, en cambio, falla', !!error);
}

console.log('\n=== Después de escribir, la foto NO se tira ===');
{
  // Era el desperdicio más grande: `arranque` escribe ULTIMO ACCESO en CADA
  // apertura de la app, tiraba la foto, y la consulta siguiente volvía a leer.
  // El caché existía pero casi nunca se usaba.
  const g = gestor({ cupo: cupoFalso(true), segundos: 60 });

  const l = await g.traer(true);
  const despues = { H: [['A'], ['1'], ['fila nueva']] };
  g.trasEscribir(l.version, despues);

  const r = await g.traer(false);
  chk('la consulta siguiente no vuelve a leer', g._estado.lecturas === 1, g._estado.lecturas);
  chk('y ya ve lo que se acaba de escribir',
      r.foto.H.length === 3 && r.foto.H[2][0] === 'fila nueva', r.foto.H);
}

console.log('\n=== Pero si otro escribió en el medio, sí se tira ===');
{
  // La copia de esta petición no tiene la escritura ajena. Quedársela borraría
  // un dato de otra persona del caché — silenciosamente.
  const g = gestor({ cupo: cupoFalso(true), segundos: 60 });

  const mia = await g.traer(true);
  g.trasEscribir(mia.version, { H: [['de otro']] });   // escritura ajena, versión avanza
  g.trasEscribir(mia.version, { H: [['la mía']] });    // la nuestra llega con la versión vieja

  chk('el caché quedó vacío en vez de quedarse con una copia incompleta',
      g.estado().guardada === false, g.estado());

  await g.traer(false);
  chk('y la consulta siguiente lee de verdad', g._estado.lecturas === 2, g._estado.lecturas);
}

console.log('\n=== Si la escritura falla, lo guardado no es de fiar ===');
{
  const g = gestor({ cupo: cupoFalso(true), segundos: 60 });
  await g.traer(true);
  g.escrituraFallida();
  chk('el caché se descarta', g.estado().guardada === false, g.estado());
}

console.log('\n=== `arranque` no puede volver a forzar una lectura ===');
{
  // Es la acción MÁS frecuente del sistema: se dispara al abrir la app, incluso
  // en la pantalla de ingreso, antes de que nadie haya entrado. Tenerla en la
  // lista de "exige estado real" era lo que multiplicaba el consumo.
  chk('arranque NO exige lectura fresca',
      ACCIONES_QUE_EXIGEN_FRESCO.indexOf('arranque') === -1, ACCIONES_QUE_EXIGEN_FRESCO);
  chk('entrar tampoco',
      ACCIONES_QUE_EXIGEN_FRESCO.indexOf('iniciar_sesion') === -1, ACCIONES_QUE_EXIGEN_FRESCO);

  // Y lo que SÍ tiene que seguir exigiéndola: el guardia contra pagos
  // duplicados compara con lo ya escrito. Sobre una foto vieja no ve el pago
  // anterior y lo registra dos veces — el problema que ya pasó una vez.
  ['registrar_pago', 'decidir_solicitud', 'registrar_traslado', 'ajustar_saldo']
    .forEach(a => chk(a + ' sigue exigiendo estado real',
                      ACCIONES_QUE_EXIGEN_FRESCO.indexOf(a) !== -1, ACCIONES_QUE_EXIGEN_FRESCO));
}

console.log('\n=== La lista de pestañas no se pregunta en cada lectura ===');
{
  // Costaba una lectura de cuota ENTERA por cada foto: el doble de lo
  // necesario, para una respuesta que casi nunca cambia.
  const hojas = require('./src/hojas');
  chk('hojas.js expone cómo olvidar la lista guardada',
      typeof hojas.olvidarNombres === 'function');
  chk('y sabe reconocer un error de cuota',
      hojas.esDeCuota({ code: 429 }) === true && hojas.esDeCuota({ code: 500 }) === false);

  const fuente = require('fs').readFileSync(require('path').join(__dirname, 'src', 'hojas.js'), 'utf8');
  chk('cada llamada a la API pasa por el contador de cuota',
      (fuente.match(/cupo\.anotar\(\)/g) || []).length === 2, fuente.match(/cupo\.anotar\(\)/g));

  // Reintentar un 429 no es esperar a que se libere la cuota: es gastar el
  // cupo que hace falta para que se libere. La biblioteca de Google lo hace
  // por defecto, hasta 3 veces.
  chk('el 429 NO se reintenta',
      /statusCodesToRetry: \[\[500, 599\]\]/.test(fuente), 'falta desactivar el reintento de 429');
}

console.log('\n=== El 429 se reconoce venga como venga ===');
{
  // El código del error NO está siempre en el mismo lugar. En gaxios 6 (la
  // versión instalada) el 429 llega como `err.status` y `err.code` queda SIN
  // DEFINIR — solo se llena si el error de abajo traía uno propio. Mirar un
  // solo campo, o encadenarlos con `||` (que se corta con el primer valor no
  // vacío, aunque sea un texto), deja pasar el error sin traducir: y ahí el
  // texto en inglés de Google termina en la pantalla de un usuario.
  const { esDeCuota } = require('./src/hojas');

  chk('como err.status (así lo manda gaxios 6)', esDeCuota({ status: 429 }));
  chk('como err.code',                            esDeCuota({ code: 429 }));
  chk('como err.response.status',                 esDeCuota({ response: { status: 429 } }));
  chk('con code de texto Y status 429 (el caso que se escapaba)',
      esDeCuota({ code: 'ERR_BAD_REQUEST', response: { status: 429 } }));
  chk('por el motivo que informa Google',         esDeCuota({ errors: [{ reason: 429 }] }));
  chk('y como última red, por el texto',
      esDeCuota({ message: "Quota exceeded for quota metric 'Read requests'" }));

  chk('un 500 NO es cuota',        esDeCuota({ status: 500 }) === false);
  chk('un error cualquiera tampoco', esDeCuota({ message: 'se cayó la red' }) === false);
  chk('y un error vacío no explota', esDeCuota(null) === false);
}

console.log('\n=== Ningún texto de Google llega a pantalla ===');
{
  const { traducirError } = require('./src/errores');

  // EL caso. Este texto exacto apareció en la pantalla de ingreso de una
  // usuaria, en inglés y con el número de proyecto adentro.
  const elQueSeEscapo = new Error(
    "Quota exceeded for quota metric 'Read requests' and limit 'Read requests " +
    "per minute per user' of service 'sheets.googleapis.com' for consumer " +
    "'project_number:165996240052'."
  );
  const r = traducirError(elQueSeEscapo);

  chk('se reconoce como cuota aunque NO venga marcado', r.codigo === 'CUOTA', r);
  chk('responde 503, no 500: es "ahora no", no una falla', r.http === 503, r.http);
  chk('el usuario NO lee el texto de Google',
      !/Quota exceeded|project_number|googleapis/.test(r.message), r.message);
  chk('lee algo en castellano y accionable', /volvé a intentar/i.test(r.message), r.message);
  chk('pero el detalle crudo queda para el registro',
      /project_number/.test(r.registro), r.registro);

  // Un 429 que llegue por código, sin texto reconocible.
  const porCodigo = traducirError(Object.assign(new Error('Request failed'), { status: 429 }));
  chk('un 429 por código también se tapa', porCodigo.codigo === 'CUOTA', porCodigo);

  // Cualquier otro mensaje de Google tampoco se muestra crudo.
  const otro = traducirError(new Error('invalid_grant: Invalid JWT Signature.'));
  chk('un error de credenciales no se muestra crudo',
      otro.codigo === 'GOOGLE' && !/invalid_grant/.test(otro.message), otro);
  chk('pero sí queda registrado', /invalid_grant/.test(otro.registro), otro.registro);

  // Lo NUESTRO sí se muestra: esos mensajes están escritos para que sirvan.
  const propio = traducirError(new Error('Faltan las credenciales. Definí GOOGLE_CREDENCIALES_JSON.'));
  chk('un mensaje nuestro se muestra tal cual',
      propio.http === 500 && /Faltan las credenciales/.test(propio.message), propio);

  // El mensaje propio de cuota es más preciso: aclara que no se registró nada.
  const deEscritura = Object.assign(new Error('...Esperá unos segundos y volvé a intentar. No se registró nada.'), { cuota: true });
  chk('en una escritura se conserva el "no se registró nada"',
      /No se registró nada/.test(traducirError(deEscritura).message), traducirError(deEscritura));

  chk('un error sin mensaje no deja al usuario sin nada',
      traducirError(new Error('')).message.length > 0, traducirError(new Error('')));
}

console.log('\n=== Poder distinguir una pantalla vieja de un error real ===');
{
  // Cuando alguien reporta "me sale este mensaje", no había forma de saber si
  // su petición siquiera llegó al servidor. Un mensaje viejo pegado en la
  // pantalla y un error real se ven EXACTAMENTE IGUAL.
  const fuente = require('fs').readFileSync(require('path').join(__dirname, 'src', 'servidor.js'), 'utf8');

  chk('/salud informa los últimos errores', /ultimosErrores: ULTIMOS_ERRORES/.test(fuente));

  // Se sirve sin contraseña: no puede llevar datos de nadie.
  const guardado = (fuente.split('function recordarError')[1] || '').split('\n}')[0];
  chk('guarda qué acción, qué código y cuándo',
      /accion/.test(guardado) && /codigo/.test(guardado) && /cuando/.test(guardado), guardado);
  chk('pero NO el texto del error ni correos ni tokens',
      !/message|correo|token|idToken/i.test(guardado), guardado);
}

console.log('\n=== Borrar 867 filas no puede costar 867 llamadas ===');
{
  // EL caso real del 19/09/2026. La hoja SESIONES tenía 884 filas y 867 de
  // ellas estaban VACÍAS (quedaron al convertirla en Tabla). Una fila vacía no
  // tiene fecha de vencimiento, así que `limpiarSesionesVencidas_` la borra
  // —correcto— pero emitía un `deleteRow` por fila.
  //
  // Cada uno costaba DOS llamadas a la API: un `spreadsheets.get` para saber
  // el id de la hoja y un `batchUpdate` para borrar. O sea ~867 lecturas y
  // ~867 escrituras en UN SOLO ingreso, contra 60 por minuto de cada tipo.
  const esc = require('./src/escribir');
  cupo.reiniciar();

  const llamadas = [];
  const apiFalsa = {
    spreadsheets: {
      get: async () => { llamadas.push('get'); return { data: { sheets: [
        { properties: { sheetId: 77, title: 'SESIONES' } }
      ] } }; },
      batchUpdate: async (p) => {
        llamadas.push('batchUpdate');
        (p.requestBody.requests || []).forEach(r => {
          if (r.deleteDimension) {
            const g = r.deleteDimension.range;
            llamadas.push('borra filas ' + (g.startIndex + 1) + '-' + g.endIndex);
          }
        });
        return {};
      },
      values: {
        batchUpdate: async () => { llamadas.push('values.batchUpdate'); return {}; },
        append:      async () => { llamadas.push('append'); return {}; }
      }
    }
  };

  (async () => {
    // Igual que la lógica: de abajo hacia arriba, una fila por vez.
    const cambios = [];
    for (let fila = 884; fila >= 18; fila--) {
      cambios.push({ tipo: 'borrar', hoja: 'SESIONES', desde: fila, cantidad: 1 });
    }
    await esc.aplicar(cambios, apiFalsa, 'doc');

    const gets  = llamadas.filter(l => l === 'get').length;
    const bu    = llamadas.filter(l => l === 'batchUpdate').length;
    const rango = llamadas.filter(l => l.indexOf('borra filas') === 0);

    chk('867 borrados = UNA consulta del id de hoja', gets === 1, gets);
    chk('867 borrados = UNA escritura',               bu === 1, bu);
    chk('y las filas contiguas van como UN rango',    rango.length === 1, rango);
    chk('borra exactamente las filas 18 a 884',       rango[0] === 'borra filas 18-884', rango[0]);
    chk('quedan contadas como 1 lectura y 1 escritura',
        cupo.usadas() === 1 && cupo.escriturasUsadas() === 1,
        [cupo.usadas(), cupo.escriturasUsadas()]);

    // Lo que NO se puede romper: el orden y el significado.
    llamadas.length = 0;
    await esc.aplicar([
      { tipo: 'escribir', hoja: 'SESIONES', fila: 2, col: 1, valores: [['antes']] },
      { tipo: 'borrar',   hoja: 'SESIONES', desde: 10, cantidad: 1 },
      { tipo: 'escribir', hoja: 'SESIONES', fila: 3, col: 1, valores: [['despues']] }
    ], apiFalsa, 'doc');

    const iAntes   = llamadas.indexOf('values.batchUpdate');
    const iBorrado = llamadas.indexOf('batchUpdate');
    const iDespues = llamadas.lastIndexOf('values.batchUpdate');
    chk('lo escrito ANTES de un borrado se baja antes', iAntes !== -1 && iAntes < iBorrado, llamadas);
    chk('y lo escrito DESPUÉS se baja después',         iDespues > iBorrado, llamadas);

    // Borrados NO contiguos no se pueden fusionar: borrarían filas distintas.
    llamadas.length = 0;
    await esc.aplicar([
      { tipo: 'borrar', hoja: 'SESIONES', desde: 50, cantidad: 1 },
      { tipo: 'borrar', hoja: 'SESIONES', desde: 20, cantidad: 1 }
    ], apiFalsa, 'doc');
    const sueltos = llamadas.filter(l => l.indexOf('borra filas') === 0);
    chk('dos borrados separados siguen siendo dos rangos', sueltos.length === 2, sueltos);
    chk('en el mismo orden que los pidió la lógica',
        sueltos[0] === 'borra filas 50-50' && sueltos[1] === 'borra filas 20-20', sueltos);
    chk('pero en UNA sola llamada',
        llamadas.filter(l => l === 'batchUpdate').length === 1, llamadas);
    // Con DOS rangos se nota si el id de hoja se vuelve a preguntar por cada
    // uno. Con un rango solo no se nota — y ahí la prueba no probaría nada.
    chk('el id de hoja se pregunta UNA vez, no una por rango',
        llamadas.filter(l => l === 'get').length === 1,
        llamadas.filter(l => l === 'get').length);

    console.log('\n=== La limpieza de sesiones borra por bloques ===');
    {
      // La fuente del problema: si vuelve a emitir un borrado por fila, el
      // arreglo de arriba lo amortigua pero la lógica sigue estando mal — y en
      // Apps Script (que es la vuelta atrás) volvería a ser 867 llamadas.
      const gs = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'apps-script.gs'), 'utf8');
      const cuerpo = gs.split('function limpiarSesionesVencidas_')[1].split('\n}')[0];

      chk('usa deleteRows por bloques', /deleteRows\(/.test(cuerpo), 'sigue borrando de a una');
      chk('y ya no llama a deleteRow fila por fila',
          !/deleteRow\(/.test(cuerpo), 'quedó un deleteRow suelto');
      chk('de abajo hacia arriba, para no correr los índices',
          /reverse\(\)/.test(cuerpo), 'falta el reverse');
    }

    console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
    process.exit(fallos ? 1 : 0);
  })();
}

})();
