// Pruebas del panel de mensajes.
// Uso: node prueba-mensajes.js
//
// Lo que más importa acá NO es que el chat funcione: es que un empleado NO
// pueda leer ni escribir en la conversación de otro. Un chat que pierde un
// mensaje es molesto; uno que muestra el de otro es un incidente.
//
// La base es falsa a propósito: estas comprobaciones tienen que poder correr
// sin Postgres, sin credenciales y sin red, igual que el resto de las suites.
//
// ⚠️ LO QUE ESTO NO PRUEBA: que el SQL sea válido para Postgres. La base falsa
// reconoce las consultas por su forma, no las ejecuta. Si una consulta cambia
// y la falsa no la reconoce, FALLA EN VOZ ALTA (lanza) en vez de pasar en
// silencio — pero un error de sintaxis que la falsa acepte solo lo descubre la
// base real. Por eso el primer arranque contra Postgres hay que mirarlo.

const { crearMensajes, MAX_TEXTO, ACCIONES } = require('./src/mensajes');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

// ─── La base falsa ────────────────────────────────────────────────────────
//
// Guarda filas en memoria y responde a las MISMAS consultas que hace el
// módulo. Una consulta que no reconozca lanza: así, si alguien cambia el SQL
// y se olvida de esto, la prueba se queja en vez de dar por buena una
// respuesta vacía.
function baseFalsa() {
  const filas = [];
  const subs  = {};
  const registro = [];
  let seq = 0;

  async function consulta(sql, params) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    registro.push({ sql: s, params: params });
    const p = params || [];

    if (/^CREATE /i.test(s)) return { rows: [] };

    if (/^INSERT INTO suscripciones/i.test(s)) {
      subs[p[0]] = { correo: p[1], datos: p[2] };
      return { rows: [] };
    }

    if (/^INSERT INTO mensajes/i.test(s)) {
      const f = {
        id: ++seq, conversacion: p[0], autor: p[1], autor_nombre: p[2],
        es_admin: p[3], texto: p[4], creado: new Date(2026, 9, 26, 10, seq), leido: null
      };
      filas.push(f);
      return { rows: [f] };
    }

    if (/^UPDATE mensajes SET leido/i.test(s)) {
      filas.forEach(function (f) {
        if (f.conversacion === p[0] && !f.leido && f.es_admin === p[1]) f.leido = new Date();
      });
      return { rows: [] };
    }

    if (/^SELECT conversacion, MAX\(id\)/i.test(s)) {
      // El filtro se LEE del SQL, no se reimplementa acá. Si se copiara la
      // regla a mano, cambiar la consulta no cambiaría nada en la prueba y la
      // comprobación de "no leídos" pasaría siempre — que es exactamente lo
      // que una mutación destapó la primera vez que se escribió esto.
      const soloDelEmpleado = /FILTER \(WHERE es_admin = false AND leido IS NULL\)/i.test(s);
      const por = {};
      filas.forEach(function (f) {
        const d = por[f.conversacion] || (por[f.conversacion] = { conversacion: f.conversacion, ultimo_id: 0, sin_leer: 0 });
        if (f.id > d.ultimo_id) d.ultimo_id = f.id;
        if (!f.leido && (!soloDelEmpleado || f.es_admin === false)) d.sin_leer++;
      });
      return { rows: Object.keys(por).map(function (k) { return por[k]; }) };
    }

    if (/WHERE id = ANY/i.test(s)) {
      return { rows: filas.filter(function (f) { return p[0].indexOf(f.id) !== -1; }) };
    }

    if (/^SELECT id, autor/i.test(s)) {
      return { rows: filas.filter(function (f) {
        return f.conversacion === p[0] && f.id > p[1];
      }) };
    }

    throw new Error('la base falsa no reconoce esta consulta: ' + s);
  }

  return { consulta: consulta, filas: filas, subs: subs, registro: registro };
}

const PERSONAS = [
  { correo: 'nathan@ylevigroup.com', nombre: 'Nathan',  rol: 'admin' },
  { correo: 'jose@ylevigroup.com',   nombre: 'Jose',    rol: 'usuario' },
  { correo: 'laura@ylevigroup.com',  nombre: 'Laura',   rol: 'usuario' }
];

const ADMIN = { autenticado: true, correo: 'nathan@ylevigroup.com', nombre: 'Nathan', rol: 'admin' };
const JOSE  = { autenticado: true, correo: 'jose@ylevigroup.com',   nombre: 'Jose',   rol: 'usuario' };
const LAURA = { autenticado: true, correo: 'laura@ylevigroup.com',  nombre: 'Laura',  rol: 'usuario' };

function montar(avisar) {
  const base = baseFalsa();
  const m = crearMensajes({ consulta: base.consulta, avisar: avisar });
  return { m: m, base: base };
}

(async function () {

console.log('\n=== Un empleado solo entra a SU conversación ===');
{
  const { m, base } = montar();

  // Jose pide descaradamente la conversación de Laura.
  await m.atender({ action: 'enviar_mensaje', conversacion: 'laura@ylevigroup.com',
                    texto: 'esto no debería caer en el hilo de Laura' }, JOSE, PERSONAS);

  chk('escribir en el hilo ajeno escribe en el propio',
      base.filas.length === 1 && base.filas[0].conversacion === 'jose@ylevigroup.com',
      base.filas[0] && base.filas[0].conversacion);

  const leido = await m.atender({ action: 'consultar_mensajes',
                                  conversacion: 'laura@ylevigroup.com' }, JOSE, PERSONAS);
  chk('y leer el hilo ajeno devuelve el propio',
      leido.conversacion === 'jose@ylevigroup.com', leido.conversacion);

  chk('a un empleado NO se le manda la lista de conversaciones',
      leido.hilos === undefined, Object.keys(leido));
}

console.log('\n=== Sin sesión no se hace nada ===');
{
  const { m } = montar();
  for (const accion of ['consultar_mensajes', 'enviar_mensaje', 'marcar_leido']) {
    let err = null;
    try { await m.atender({ action: accion, texto: 'hola' }, { autenticado: false }, PERSONAS); }
    catch (e) { err = e; }
    chk(accion + ' exige sesión', err && err.message === 'SESION_INVALIDA', err && err.message);
  }
}

console.log('\n=== El administrador sí elige con quién habla ===');
{
  const { m, base } = montar();
  const r = await m.atender({ action: 'enviar_mensaje', conversacion: 'laura@ylevigroup.com',
                              texto: 'Laura, pasá por la oficina' }, ADMIN, PERSONAS);
  chk('el mensaje se guarda en el hilo elegido',
      r.status === 'success' && base.filas[0].conversacion === 'laura@ylevigroup.com',
      base.filas[0]);
  chk('y queda marcado como del administrador', base.filas[0].es_admin === true);
  chk('con el nombre de quien escribe, no el del cuerpo',
      base.filas[0].autor_nombre === 'Nathan' && base.filas[0].autor === 'nathan@ylevigroup.com',
      base.filas[0].autor);
}

console.log('\n=== No se le puede escribir a cualquiera ===');
{
  const { m, base } = montar();
  const r = await m.atender({ action: 'enviar_mensaje', conversacion: 'nadie@ejemplo.com',
                              texto: 'hola' }, ADMIN, PERSONAS);
  chk('un correo que no existe se rechaza', r.status === 'error', r);
  chk('y no deja nada escrito', base.filas.length === 0, base.filas.length);

  // Escribirle a otro administrador tampoco: los hilos son admin <-> empleado.
  const r2 = await m.atender({ action: 'enviar_mensaje', conversacion: 'nathan@ylevigroup.com',
                               texto: 'hola' }, ADMIN, PERSONAS);
  chk('y a otro administrador tampoco', r2.status === 'error', r2);
}

console.log('\n=== El texto se valida ===');
{
  const { m, base } = montar();

  const vacio = await m.atender({ action: 'enviar_mensaje', texto: '   ' }, JOSE, PERSONAS);
  chk('un mensaje en blanco se rechaza', vacio.status === 'error', vacio);

  const largo = await m.atender({ action: 'enviar_mensaje',
                                  texto: 'x'.repeat(MAX_TEXTO + 1) }, JOSE, PERSONAS);
  chk('uno demasiado largo también', largo.status === 'error', largo);
  chk('y el tope se nombra en el mensaje',
      /2000/.test(String(largo.message)), largo.message);

  const justo = await m.atender({ action: 'enviar_mensaje',
                                  texto: 'x'.repeat(MAX_TEXTO) }, JOSE, PERSONAS);
  chk('el tope exacto SÍ pasa', justo.status === 'success', justo);
  chk('nada de lo rechazado quedó guardado', base.filas.length === 1, base.filas.length);
}

console.log('\n=== Lo leído es lo del OTRO lado ===');
{
  const { m, base } = montar();
  await m.atender({ action: 'enviar_mensaje', texto: 'jefe, una consulta' }, JOSE, PERSONAS);
  await m.atender({ action: 'enviar_mensaje', conversacion: 'jose@ylevigroup.com',
                    texto: 'decime' }, ADMIN, PERSONAS);

  await m.atender({ action: 'marcar_leido', conversacion: 'jose@ylevigroup.com' }, ADMIN, PERSONAS);

  const delEmpleado = base.filas.filter(function (f) { return !f.es_admin; })[0];
  const delAdmin    = base.filas.filter(function (f) { return f.es_admin; })[0];
  chk('el administrador marca leído lo del empleado', !!delEmpleado.leido);
  chk('y NO marca lo suyo propio', !delAdmin.leido);

  await m.atender({ action: 'marcar_leido' }, JOSE, PERSONAS);
  chk('el empleado marca leído lo del administrador', !!delAdmin.leido);
}

console.log('\n=== La lista de conversaciones del administrador ===');
{
  const { m } = montar();
  await m.atender({ action: 'enviar_mensaje', texto: 'pregunta 1' }, JOSE, PERSONAS);
  await m.atender({ action: 'enviar_mensaje', texto: 'pregunta 2' }, JOSE, PERSONAS);
  // Y el administrador contesta algo que el empleado todavía no leyó. Sin este
  // mensaje, contar "todo lo no leído" y contar "lo no leído del empleado"
  // darían el mismo número y la comprobación de abajo no probaría nada.
  await m.atender({ action: 'enviar_mensaje', conversacion: 'jose@ylevigroup.com',
                    texto: 'ya te contesto' }, ADMIN, PERSONAS);

  const r = await m.atender({ action: 'consultar_mensajes' }, ADMIN, PERSONAS);
  chk('sin hilo elegido devuelve la lista', Array.isArray(r.hilos), r);

  const jose  = r.hilos.filter(function (h) { return h.conversacion === 'jose@ylevigroup.com'; })[0];
  const laura = r.hilos.filter(function (h) { return h.conversacion === 'laura@ylevigroup.com'; })[0];

  chk('cuenta solo los no leídos DEL EMPLEADO', jose && jose.sinLeer === 2, jose);
  chk('y muestra el último mensaje', jose && jose.ultimo === 'ya te contesto', jose && jose.ultimo);
  chk('sabiendo de qué lado vino', jose && jose.ultimoEsAdmin === true, jose);
  chk('quien nunca escribió aparece igual', !!laura, r.hilos.map(function (h) { return h.conversacion; }));
  chk('con cero sin leer', laura && laura.sinLeer === 0, laura);
  chk('los administradores no se listan a sí mismos',
      r.hilos.every(function (h) { return h.conversacion !== 'nathan@ylevigroup.com'; }),
      r.hilos.map(function (h) { return h.conversacion; }));
  chk('primero quien espera respuesta', r.hilos[0].conversacion === 'jose@ylevigroup.com',
      r.hilos.map(function (h) { return h.conversacion + ':' + h.sinLeer; }));
}

console.log('\n=== Pedir solo lo nuevo ===');
{
  const { m } = montar();
  await m.atender({ action: 'enviar_mensaje', texto: 'uno' }, JOSE, PERSONAS);
  await m.atender({ action: 'enviar_mensaje', texto: 'dos' }, JOSE, PERSONAS);

  const todo = await m.atender({ action: 'consultar_mensajes' }, JOSE, PERSONAS);
  chk('sin "desde" vienen todos', todo.mensajes.length === 2, todo.mensajes.length);

  const nuevo = await m.atender({ action: 'consultar_mensajes', desde: todo.mensajes[0].id }, JOSE, PERSONAS);
  chk('con "desde" solo lo posterior',
      nuevo.mensajes.length === 1 && nuevo.mensajes[0].texto === 'dos', nuevo.mensajes);
}

console.log('\n=== La suscripción se guarda a nombre de quien la pide ===');
{
  const { m, base } = montar();
  // El cuerpo intenta registrar el teléfono a nombre de Laura.
  await m.atender({ action: 'guardar_suscripcion', correo: 'laura@ylevigroup.com',
                    suscripcion: { endpoint: 'https://push/abc', keys: { auth: 'x' } } },
                  JOSE, PERSONAS);
  chk('queda a nombre de la sesión, no del cuerpo',
      base.subs['https://push/abc'].correo === 'jose@ylevigroup.com',
      base.subs['https://push/abc']);

  const sinEndpoint = await m.atender({ action: 'guardar_suscripcion', suscripcion: {} }, JOSE, PERSONAS);
  chk('una suscripción sin endpoint se rechaza', sinEndpoint.status === 'error', sinEndpoint);

  // El mismo dispositivo dos veces es UNA fila, o la notificación llega doble.
  await m.atender({ action: 'guardar_suscripcion',
                    suscripcion: { endpoint: 'https://push/abc', keys: { auth: 'y' } } }, JOSE, PERSONAS);
  chk('re-suscribirse no duplica el dispositivo',
      Object.keys(base.subs).length === 1, Object.keys(base.subs));
}

console.log('\n=== Un aviso que falla no voltea el mensaje ===');
{
  // Es el mismo criterio que avisarSiCruzaPresupuesto_: el dato ya quedó
  // guardado, la notificación es un extra.
  const { m, base } = montar(function () { return Promise.reject(new Error('push caído')); });
  const r = await m.atender({ action: 'enviar_mensaje', texto: 'igual se guarda' }, JOSE, PERSONAS);
  chk('el envío sigue siendo exitoso', r.status === 'success', r);
  chk('y el mensaje quedó escrito', base.filas.length === 1, base.filas.length);
}

console.log('\n=== El aviso recibe lo que necesita para notificar ===');
{
  let visto = null;
  const { m } = montar(function (d) { visto = d; return Promise.resolve(); });
  await m.atender({ action: 'enviar_mensaje', conversacion: 'jose@ylevigroup.com',
                    texto: 'pasá por la oficina' }, ADMIN, PERSONAS);
  chk('sabe a qué hilo va', visto && visto.hilo === 'jose@ylevigroup.com', visto);
  chk('sabe que lo mandó un administrador', visto && visto.esAdmin === true, visto);
  chk('y lleva el texto y el autor',
      visto && visto.mensaje.texto === 'pasá por la oficina' && visto.mensaje.nombre === 'Nathan',
      visto && visto.mensaje);
}

console.log('\n=== Una acción desconocida no pasa en silencio ===');
{
  const { m } = montar();
  const r = await m.atender({ action: 'borrar_todo' }, ADMIN, PERSONAS);
  chk('se rechaza y se nombra', r.status === 'error' && /borrar_todo/.test(r.message), r);
}

// ══════════════════════════════════════════════════════════════════════════
// La notificación al teléfono
// ══════════════════════════════════════════════════════════════════════════

const { crearPush, LARGO_VISTA } = require('./src/push');

// Una base falsa chica, solo con suscripciones.
function basePush(filas) {
  const subs = filas.slice();
  const borradas = [];
  async function consulta(sql, params) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/^SELECT endpoint, datos FROM suscripciones/i.test(s)) {
      return { rows: subs.filter(function (f) { return params[0].indexOf(f.correo) !== -1; }) };
    }
    if (/^DELETE FROM suscripciones/i.test(s)) {
      params[0].forEach(function (e) { borradas.push(e); });
      return { rows: [] };
    }
    throw new Error('consulta no prevista en basePush: ' + s);
  }
  return { consulta: consulta, borradas: borradas };
}

const SUS = [
  { endpoint: 'ep-nathan',  correo: 'nathan@ylevigroup.com', datos: { endpoint: 'ep-nathan' } },
  { endpoint: 'ep-jose-1',  correo: 'jose@ylevigroup.com',   datos: { endpoint: 'ep-jose-1' } },
  { endpoint: 'ep-jose-2',  correo: 'jose@ylevigroup.com',   datos: { endpoint: 'ep-jose-2' } },
  { endpoint: 'ep-laura',   correo: 'laura@ylevigroup.com',  datos: { endpoint: 'ep-laura' } }
];

const MSG = { nombre: 'Nathan', texto: 'pasá por la oficina' };

console.log('\n=== A quién le suena ===');
{
  const b = basePush(SUS);
  const enviados = [];
  const p = crearPush({ consulta: b.consulta,
                        enviar: function (s) { enviados.push(s.endpoint); return Promise.resolve(); } });

  await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true, mensaje: MSG, personas: PERSONAS });
  chk('si escribe el administrador, le suena al empleado',
      enviados.sort().join(',') === 'ep-jose-1,ep-jose-2', enviados);
  chk('y a nadie más', enviados.indexOf('ep-laura') === -1 && enviados.indexOf('ep-nathan') === -1, enviados);
}

console.log('\n=== Todos los dispositivos de la persona ===');
{
  const b = basePush(SUS);
  const enviados = [];
  const p = crearPush({ consulta: b.consulta,
                        enviar: function (s) { enviados.push(s.endpoint); return Promise.resolve(); } });
  await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true, mensaje: MSG, personas: PERSONAS });
  chk('teléfono y computadora suenan los dos', enviados.length === 2, enviados);
}

console.log('\n=== Cuando escribe el empleado ===');
{
  const b = basePush(SUS);
  const enviados = [];
  const p = crearPush({ consulta: b.consulta,
                        enviar: function (s) { enviados.push(s.endpoint); return Promise.resolve(); } });

  await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: false,
                   mensaje: { nombre: 'Jose', texto: 'jefe' }, personas: PERSONAS });
  chk('le suena a los administradores', enviados.join(',') === 'ep-nathan', enviados);
  chk('y NO al propio empleado que escribió', enviados.indexOf('ep-jose-1') === -1, enviados);
  chk('ni a otro empleado', enviados.indexOf('ep-laura') === -1, enviados);
}

console.log('\n=== Las suscripciones muertas se borran, las caídas no ===');
{
  const b = basePush(SUS);
  const p = crearPush({ consulta: b.consulta, enviar: function (s) {
    if (s.endpoint === 'ep-jose-1') { const e = new Error('Gone'); e.statusCode = 410; throw e; }
    if (s.endpoint === 'ep-jose-2') { const e = new Error('Server Error'); e.statusCode = 500; throw e; }
    return Promise.resolve();
  } });

  const r = await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true, mensaje: MSG, personas: PERSONAS });
  chk('un 410 borra la suscripción', b.borradas.join(',') === 'ep-jose-1', b.borradas);
  chk('un 500 NO la borra', b.borradas.indexOf('ep-jose-2') === -1, b.borradas);
  chk('y lo informa', r.borradas === 1 && r.enviadas === 0, r);
}

console.log('\n=== Qué viaja en la notificación ===');
{
  const b = basePush(SUS);
  let carga = null;
  const p = crearPush({ consulta: b.consulta,
                        enviar: function (s, c) { carga = JSON.parse(c); return Promise.resolve(); } });

  const largo = 'x'.repeat(LARGO_VISTA + 50);
  await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true,
                   mensaje: { nombre: 'Nathan', texto: largo }, personas: PERSONAS });

  chk('lleva quién escribe', carga && carga.titulo === 'Nathan', carga);
  chk('lleva el hilo, para poder abrirlo al tocarla',
      carga && carga.hilo === 'jose@ylevigroup.com', carga);
  chk('recorta el texto largo', carga && carga.cuerpo.length <= LARGO_VISTA, carga && carga.cuerpo.length);
  chk('y avisa que está recortado', carga && /…$/.test(carga.cuerpo), carga && carga.cuerpo.slice(-5));
  chk('agrupa por conversación', carga && carga.etiqueta === 'chat-jose@ylevigroup.com', carga);
}

console.log('\n=== Sin suscripciones no se cae ===');
{
  const b = basePush([]);
  const p = crearPush({ consulta: b.consulta, enviar: function () { throw new Error('no debería llamarse'); } });
  const r = await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true, mensaje: MSG, personas: PERSONAS });
  chk('devuelve cero y sigue', r.enviadas === 0, r);
}

console.log('\n=== Un aviso que no llega DEJA RASTRO ===');
//
// Es la razón por la que estas comprobaciones existen: las notificaciones no
// llegaban y no había forma de saber por qué, porque cada falla moría en un
// console.error que nadie iba a leer. Las cuatro causas posibles se ven
// idénticas desde la app —el mensaje llega, el aviso no— y solo se pueden
// distinguir si el servidor dice cuál fue.
{
  const b = basePush(SUS);
  const p = crearPush({ consulta: b.consulta, enviar: function () {
    // 403 es lo que responde el servicio de push cuando la clave VAPID del
    // servidor no es la que el navegador usó para suscribirse. Es un error de
    // configuración silencioso: nada falla, simplemente nunca suena.
    const e = new Error('Received unexpected response code');
    e.statusCode = 403;
    throw e;
  } });

  const r = await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true,
                             mensaje: MSG, personas: PERSONAS });
  chk('un rechazo del servicio de push se informa, no se traga',
      r.fallas.length === 2, r);
  chk('con el código, que es lo que identifica la causa',
      r.fallas.every(function (f) { return f.codigo === 403; }), r.fallas);
  chk('y el motivo dice que fue rechazado', r.motivo === 'RECHAZADO', r.motivo);
  chk('un 403 NO borra la suscripción (el error es del servidor, no del teléfono)',
      b.borradas.length === 0, b.borradas);
}

{
  const b = basePush([]);
  const p = crearPush({ consulta: b.consulta, enviar: function () { return Promise.resolve(); } });
  const r = await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true,
                             mensaje: MSG, personas: PERSONAS });
  chk('nadie registrado se distingue de un rechazo',
      r.motivo === 'SIN_SUSCRIPCIONES' && r.fallas.length === 0, r);
}

{
  const b = basePush(SUS);
  const p = crearPush({ consulta: b.consulta, enviar: function () { return Promise.resolve(); } });
  const r = await p.avisar({ hilo: 'jose@ylevigroup.com', esAdmin: true,
                             mensaje: MSG, personas: PERSONAS });
  chk('y un envío logrado también lo dice', r.motivo === 'OK' && r.enviadas === 2, r);
  chk('informando cuántos teléfonos había registrados', r.registrados === 2, r);
}

console.log('\n=== Quien escribe se entera de si del otro lado va a sonar ===');
{
  // Sin esto, el aviso podía estar fallando en TODOS los mensajes durante
  // semanas sin que ninguna pantalla lo mostrara.
  const { m } = montar(function () {
    return Promise.resolve({ enviadas: 0, registrados: 0, fallas: [], motivo: 'SIN_SUSCRIPCIONES' });
  });
  const r = await m.atender({ action: 'enviar_mensaje', conversacion: 'jose@ylevigroup.com',
                              texto: 'hola' }, ADMIN, PERSONAS);
  chk('el mensaje se guarda igual', r.status === 'success' && !!r.mensaje, r);
  chk('y la respuesta trae qué pasó con el aviso',
      r.aviso && r.aviso.motivo === 'SIN_SUSCRIPCIONES', r.aviso);
}

{
  // Un aviso que LANZA no puede voltear un mensaje ya guardado, pero sí tiene
  // que quedar reportado.
  const { m } = montar(function () { return Promise.reject(new Error('push caido')); });
  const r = await m.atender({ action: 'enviar_mensaje', conversacion: 'jose@ylevigroup.com',
                              texto: 'hola' }, ADMIN, PERSONAS);
  chk('si el aviso explota, el mensaje igual se guardó', r.status === 'success', r);
  chk('y la falla se reporta en vez de desaparecer',
      r.aviso && r.aviso.motivo === 'ERROR' &&
      r.aviso.fallas[0].mensaje.indexOf('push caido') !== -1, r.aviso);
}

{
  // El caso del servidor sin claves VAPID: NO se puede confundir con un envío.
  const { m } = montar(null);   // sin avisar: el módulo usa su propio respaldo
  const r = await m.atender({ action: 'enviar_mensaje', conversacion: 'jose@ylevigroup.com',
                              texto: 'hola' }, ADMIN, PERSONAS);
  chk('sin claves VAPID el motivo lo dice', r.aviso && r.aviso.motivo === 'SIN_VAPID', r.aviso);
}

console.log('\n=== La prueba de aviso se manda a UNO MISMO ===');
//
// Si la prueba del administrador despertara al empleado, nadie la usaría dos
// veces. Y tiene que ir por el MISMO camino que un mensaje real: una prueba
// que use otro camino puede pasar mientras lo de verdad falla.
{
  const b = basePush(SUS);
  const enviados = [];
  const envio = crearPush({ consulta: b.consulta,
                            enviar: function (s) { enviados.push(s.endpoint); return Promise.resolve(); } });
  const { m } = montar(envio.avisar);

  const r = await m.atender({ action: 'probar_aviso' }, ADMIN, PERSONAS);
  chk('le llega al que probó', enviados.join(',') === 'ep-nathan', enviados);
  chk('y a ningún empleado', enviados.indexOf('ep-jose-1') === -1, enviados);
  chk('devuelve el resultado real del envío',
      r.status === 'success' && r.aviso.enviadas === 1, r);
}

{
  const b = basePush(SUS);
  const enviados = [];
  const envio = crearPush({ consulta: b.consulta,
                            enviar: function (s) { enviados.push(s.endpoint); return Promise.resolve(); } });
  const { m } = montar(envio.avisar);

  await m.atender({ action: 'probar_aviso' }, JOSE, PERSONAS);
  chk('un empleado se prueba a sí mismo, no a la administración',
      enviados.sort().join(',') === 'ep-jose-1,ep-jose-2', enviados);
}

{
  // Probar no es mandar un mensaje: si dejara texto escrito, el empleado
  // vería aparecer pruebas en su conversación.
  const base = baseFalsa();
  const m = crearMensajes({ consulta: base.consulta, avisar: function () {
    return Promise.resolve({ enviadas: 1, registrados: 1, fallas: [], motivo: 'OK' });
  } });
  await m.atender({ action: 'probar_aviso' }, ADMIN, PERSONAS);
  const leido = await m.atender({ action: 'consultar_mensajes',
                                  conversacion: 'jose@ylevigroup.com' }, ADMIN, PERSONAS);
  chk('la prueba no deja ningún mensaje escrito', leido.mensajes.length === 0, leido.mensajes);
}

console.log('\n=== La lista de acciones y lo que el modulo atiende no se separan ===');
//
// `ACCIONES` es lo que el servidor desvia al chat. Una accion atendida que no
// este en esa lista NUNCA llega: cae en la logica del Sheet y vuelve como
// "accion no reconocida". Al reves, una de la lista que nadie atienda devuelve
// un error en vez de hacer algo. Las dos cosas son codigo muerto que parece
// vivo, y ninguna prueba que llame a `atender` directo las puede ver.
{
  const fuente = require('fs')
    .readFileSync(require.resolve('./src/mensajes'), 'utf8')
    .replace(/\r\n/g, '\n');

  const atendidas = [];
  const re = /accion === '([a-z_]+)'/g;
  let hallado;
  while ((hallado = re.exec(fuente)) !== null) atendidas.push(hallado[1]);

  chk('se encontraron las acciones atendidas en el fuente', atendidas.length >= 5, atendidas);

  const sinDesviar = atendidas.filter(function (a) { return ACCIONES.indexOf(a) === -1; });
  chk('toda accion atendida esta en la lista que el servidor desvia',
      sinDesviar.length === 0, sinDesviar);

  const sinAtender = ACCIONES.filter(function (a) { return atendidas.indexOf(a) === -1; });
  chk('y toda la lista tiene quien la atienda', sinAtender.length === 0, sinAtender);
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);

})();
