// El panel de mensajes: administradores <-> empleados.
//
// ─── Por qué esto NO vive en apps-script.gs ───────────────────────────────
//
// Es la primera pieza del sistema que corre SOLO en el servidor propio. El
// resto de la lógica vive en `apps-script.gs` para poder correr en los dos
// motores, pero un chat necesita una base de datos de verdad y Apps Script no
// puede llegar a Postgres.
//
// ⚠️ Consecuencia: si algún día se vuelve al plan B (apuntar la app a Apps
// Script), el chat deja de funcionar. Pagos, saldos y viáticos no: esos viven
// en el Sheet y los dos motores los entienden.
//
// ─── Por qué una base y no una pestaña del Sheet ──────────────────────────
//
// El servidor saca una FOTO de TODAS las pestañas para atender cualquier
// petición (ver foto.js). Una pestaña MENSAJES haría que consultar un pago
// cargara además todo el historial del chat, y eso empeora con cada mensaje
// nuevo. Un chat son muchas escrituras chicas y frecuentes: el peor caso
// posible para una hoja de cálculo.
//
// ─── Un hilo por empleado, compartido por los administradores ─────────────
//
// La conversación se identifica por el correo del EMPLEADO. Todos los
// administradores ven y escriben en el mismo hilo.
//
// Es a propósito: con un hilo por cada administrador, Joseph no vería lo que
// Nathan ya le dijo al empleado, y dos instrucciones contradictorias es justo
// lo que un canal de coordinación tiene que evitar. Además es coherente con el
// resto del sistema, donde "administrador" es un rol y no una persona
// (CORREOS_ADMIN, esAdmin_, administradoresActivos_).

const CREAR_TABLAS = [
  'CREATE TABLE IF NOT EXISTS mensajes (' +
  '  id            BIGSERIAL PRIMARY KEY,' +
  '  conversacion  TEXT        NOT NULL,' +
  '  autor         TEXT        NOT NULL,' +
  '  autor_nombre  TEXT        NOT NULL,' +
  '  es_admin      BOOLEAN     NOT NULL,' +
  '  texto         TEXT        NOT NULL,' +
  '  creado        TIMESTAMPTZ NOT NULL DEFAULT now(),' +
  '  leido         TIMESTAMPTZ' +
  ')',

  // El índice no es un lujo: toda consulta del chat filtra por conversación y
  // ordena por id. Sin él, cada apertura recorre la tabla entera.
  'CREATE INDEX IF NOT EXISTS mensajes_hilo ON mensajes (conversacion, id DESC)',

  // Una fila por DISPOSITIVO, no por persona: alguien con teléfono y
  // computadora tiene dos, y las dos tienen que sonar.
  //
  // El endpoint es la clave primaria porque es lo que el navegador vuelve a
  // mandar cuando se re-suscribe. Sin eso, cada apertura de la app agregaría
  // una suscripción más y la misma persona recibiría la notificación repetida.
  'CREATE TABLE IF NOT EXISTS suscripciones (' +
  '  endpoint  TEXT PRIMARY KEY,' +
  '  correo    TEXT        NOT NULL,' +
  '  datos     JSONB       NOT NULL,' +
  '  creado    TIMESTAMPTZ NOT NULL DEFAULT now()' +
  ')',

  'CREATE INDEX IF NOT EXISTS suscripciones_correo ON suscripciones (correo)'
];

// Un mensaje más largo que esto no es un mensaje, es un documento. El tope
// existe para que nadie pueda llenar la base con una sola petición.
const MAX_TEXTO = 2000;

// Las acciones que este módulo atiende. El servidor las desvía antes de pasar
// por la lógica del Sheet.
const ACCIONES = [
  'consultar_mensajes', 'enviar_mensaje', 'marcar_leido', 'guardar_suscripcion',
  'probar_aviso', 'contar_sin_leer'
];

// `op.consulta(sql, params)` -> Promise<{ rows }>. Entra por parámetro, igual
// que en foto.js y escribir.js, para poder probar todo esto sin una base real.
function crearMensajes(op) {
  const consulta = op.consulta;
  const avisar   = op.avisar || function () {
    // Misma forma que el envío real: así quien lee la respuesta puede
    // distinguir "el servidor no tiene claves VAPID" de "se envió bien".
    return Promise.resolve({
      enviadas: 0, borradas: 0, registrados: 0, fallas: [], motivo: 'SIN_VAPID'
    });
  };
  let tablasListas = false;

  async function asegurarTablas() {
    if (tablasListas) return;
    for (const sql of CREAR_TABLAS) await consulta(sql);
    tablasListas = true;
  }

  // EL HILO LO DECIDE EL SERVIDOR, NO EL NAVEGADOR.
  //
  // Un empleado solo lee y escribe en el suyo, mande lo que mande en el
  // cuerpo. Es el mismo criterio que `equipoDelPago_` y `CORREO REGISTRO`: lo
  // que identifica a alguien no lo elige su navegador. Ocultar las otras
  // conversaciones en la pantalla no serviría de nada, porque cualquiera puede
  // llamar a esta URL directamente.
  function hiloDe(cuerpo, ctx) {
    if (!ctx || !ctx.autenticado) throw new Error('SESION_INVALIDA');
    if (ctx.rol === 'admin') {
      return String((cuerpo && cuerpo.conversacion) || '').trim().toLowerCase();
    }
    return String(ctx.correo || '').trim().toLowerCase();
  }

  function filaAMensaje(f) {
    return {
      id:      Number(f.id),
      autor:   f.autor,
      nombre:  f.autor_nombre,
      esAdmin: f.es_admin === true,
      texto:   f.texto,
      creado:  f.creado instanceof Date ? f.creado.toISOString() : String(f.creado),
      leido:   !!f.leido
    };
  }

  // La lista de conversaciones del administrador: una por empleado activo, con
  // su último mensaje y cuántos no leyó.
  //
  // Se arma sobre `personas` (que sale de la hoja USUARIOS) y no sobre lo que
  // haya en la base: un empleado al que todavía nadie le escribió tiene que
  // aparecer igual, o no habría forma de empezar la conversación.
  async function listaDeHilos(personas) {
    const r = await consulta(
      'SELECT conversacion,' +
      '       MAX(id) AS ultimo_id,' +
      '       COUNT(*) FILTER (WHERE es_admin = false AND leido IS NULL) AS sin_leer' +
      '  FROM mensajes GROUP BY conversacion');

    const porHilo = {};
    r.rows.forEach(function (f) { porHilo[f.conversacion] = f; });

    const ultimos = {};
    const ids = r.rows.map(function (f) { return Number(f.ultimo_id); }).filter(Boolean);
    if (ids.length) {
      const u = await consulta(
        'SELECT conversacion, texto, creado, es_admin FROM mensajes WHERE id = ANY($1::bigint[])',
        [ids]);
      u.rows.forEach(function (f) { ultimos[f.conversacion] = f; });
    }

    const cuandoDe = function (f) {
      if (!f || !f.creado) return '';
      return f.creado instanceof Date ? f.creado.toISOString() : String(f.creado);
    };

    return personas
      .filter(function (p) { return p.rol !== 'admin'; })
      .map(function (p) {
        const d = porHilo[p.correo] || {};
        const u = ultimos[p.correo] || null;
        return {
          conversacion:  p.correo,
          nombre:        p.nombre || p.correo,
          sinLeer:       Number(d.sin_leer || 0),
          ultimo:        u ? u.texto : '',
          ultimoEsAdmin: u ? u.es_admin === true : false,
          cuando:        cuandoDe(u)
        };
      })
      // Primero quien está esperando respuesta, después por actividad
      // reciente. Es el orden en que uno decide a quién contestar.
      .sort(function (a, b) {
        return (b.sinLeer - a.sinLeer) || String(b.cuando).localeCompare(String(a.cuando));
      });
  }

  async function atender(cuerpo, ctx, personas) {
    await asegurarTablas();
    const accion  = String((cuerpo && cuerpo.action) || '');
    const esAdmin = ctx.rol === 'admin';
    const gente   = personas || [];

    if (accion === 'guardar_suscripcion') {
      const s = (cuerpo && cuerpo.suscripcion) || {};
      const endpoint = String(s.endpoint || '').trim();
      if (!endpoint) return { status: 'error', message: 'Falta el endpoint de la suscripción.' };
      // El correo sale de la SESIÓN, nunca del cuerpo: si no, cualquiera
      // podría registrar su teléfono a nombre de otro y recibir sus mensajes.
      await consulta(
        'INSERT INTO suscripciones (endpoint, correo, datos) VALUES ($1, $2, $3)' +
        ' ON CONFLICT (endpoint) DO UPDATE SET correo = $2, datos = $3',
        [endpoint, ctx.correo, JSON.stringify(s)]);
      return { status: 'success' };
    }

    // Solo el número de mensajes sin leer.
    //
    // Existe porque el panel corta su sondeo al salir de Mensajes —preguntar
    // cada seis segundos mientras alguien registra un pago es gastar red por
    // algo que no está mirando— y sin NADA que pregunte desde las otras
    // pantallas, un empleado podía contestar y el administrador no se enteraba:
    // ni aviso ni número en la pestaña.
    //
    // Es un COUNT, no la conversación: se puede pedir desde cualquier pantalla
    // sin traer 300 mensajes para mostrar un número.
    if (accion === 'contar_sin_leer') {
      if (esAdmin) {
        // Los mismos hilos que lista `listaDeHilos`: los de empleados activos.
        // Contar sobre toda la tabla sumaría los de alguien ya desactivado, y
        // el número no coincidiría con lo que la pantalla muestra.
        const correos = gente
          .filter(function (p) { return p.rol !== 'admin'; })
          .map(function (p) { return p.correo; });
        if (!correos.length) return { status: 'success', esAdmin: true, sinLeer: 0 };
        const r = await consulta(
          'SELECT COUNT(*)::int AS n FROM mensajes' +
          ' WHERE conversacion = ANY($1::text[]) AND es_admin = false AND leido IS NULL',
          [correos]);
        return { status: 'success', esAdmin: true, sinLeer: r.rows[0].n };
      }
      const r = await consulta(
        'SELECT COUNT(*)::int AS n FROM mensajes' +
        ' WHERE conversacion = $1 AND es_admin = true AND leido IS NULL',
        [hiloDe(cuerpo, ctx)]);
      return { status: 'success', esAdmin: false, sinLeer: r.rows[0].n };
    }

    // Probar el aviso sin depender de otra persona ni de otro teléfono.
    //
    // Es la única forma de distinguir las cuatro cosas que se parecen desde
    // afuera: que el teléfono no esté registrado, que el servidor no tenga
    // claves, que el servicio de push rechace el envío, o que el aviso sí
    // salga y el teléfono lo esté silenciando.
    if (accion === 'probar_aviso') {
      const r = await avisar({
        correos: [ctx.correo],
        hilo:    ctx.correo,
        esAdmin: esAdmin,
        personas: gente,
        mensaje: {
          nombre: 'Prueba de aviso',
          texto:  'Si esto te apareció en el teléfono, las notificaciones funcionan.'
        }
      });
      return { status: 'success', correo: ctx.correo, aviso: r };
    }

    if (accion === 'consultar_mensajes') {
      const hilo = hiloDe(cuerpo, ctx);

      // Un administrador sin hilo elegido pide la lista de conversaciones.
      if (esAdmin && !hilo) {
        return { status: 'success', esAdmin: true, hilos: await listaDeHilos(gente) };
      }

      // `desde` permite pedir solo lo nuevo. Es lo que hace que preguntar
      // seguido cueste casi nada.
      const desde = Number(cuerpo && cuerpo.desde) || 0;
      const r = await consulta(
        'SELECT id, autor, autor_nombre, es_admin, texto, creado, leido' +
        '  FROM mensajes WHERE conversacion = $1 AND id > $2' +
        ' ORDER BY id ASC LIMIT 300', [hilo, desde]);

      const salida = {
        status:       'success',
        esAdmin:      esAdmin,
        conversacion: hilo,
        mensajes:     r.rows.map(filaAMensaje)
      };
      if (esAdmin) salida.hilos = await listaDeHilos(gente);
      return salida;
    }

    if (accion === 'enviar_mensaje') {
      const hilo  = hiloDe(cuerpo, ctx);
      const texto = String((cuerpo && cuerpo.texto) || '').trim();

      if (!hilo)  return { status: 'error', message: 'Elegí a quién le escribís.' };
      if (!texto) return { status: 'error', message: 'El mensaje está vacío.' };
      if (texto.length > MAX_TEXTO) {
        return { status: 'error',
                 message: 'El mensaje es demasiado largo (máximo ' + MAX_TEXTO + ' caracteres).' };
      }
      // Un administrador solo puede escribirle a alguien que exista y esté
      // activo. Sin esto, un correo mal tipeado crearía un hilo fantasma que
      // nadie va a leer nunca, y el mensaje se daría por enviado.
      if (esAdmin && !gente.some(function (p) { return p.correo === hilo && p.rol !== 'admin'; })) {
        return { status: 'error', message: 'Esa persona no está activa en el sistema.' };
      }

      const r = await consulta(
        'INSERT INTO mensajes (conversacion, autor, autor_nombre, es_admin, texto)' +
        ' VALUES ($1, $2, $3, $4, $5)' +
        ' RETURNING id, autor, autor_nombre, es_admin, texto, creado, leido',
        [hilo, ctx.correo, ctx.nombre || ctx.correo, esAdmin, texto]);

      const guardado = filaAMensaje(r.rows[0]);

      // El aviso al teléfono va DESPUÉS de guardar y sin poder voltear nada:
      // una notificación que falle no puede deshacer un mensaje ya escrito. Es
      // el mismo criterio que `avisarSiCruzaPresupuesto_`.
      let aviso;
      try {
        aviso = await avisar({ hilo: hilo, mensaje: guardado, esAdmin: esAdmin, personas: gente });
      } catch (err) {
        console.error('[mensajes] aviso:', err && err.message);
        aviso = { enviadas: 0, fallas: [{ codigo: 0, mensaje: String((err && err.message) || err) }],
                  motivo: 'ERROR' };
      }

      // El aviso viaja con la respuesta. El mensaje se guardó igual —eso no se
      // discute—, pero quien escribió merece saber si del otro lado va a
      // sonar algo o no.
      return { status: 'success', mensaje: guardado, aviso: aviso };
    }

    if (accion === 'marcar_leido') {
      const hilo = hiloDe(cuerpo, ctx);
      if (!hilo) return { status: 'error', message: 'Falta la conversación.' };
      // Se marcan los del OTRO lado: nadie "lee" lo que escribió él mismo.
      await consulta(
        'UPDATE mensajes SET leido = now()' +
        ' WHERE conversacion = $1 AND leido IS NULL AND es_admin = $2',
        [hilo, !esAdmin]);
      return { status: 'success' };
    }

    return { status: 'error', message: 'Acción de mensajes no reconocida: ' + accion };
  }

  return {
    atender: atender,
    asegurarTablas: asegurarTablas,
    listaDeHilos: listaDeHilos,
    hiloDe: hiloDe
  };
}

module.exports = { crearMensajes: crearMensajes, ACCIONES: ACCIONES, MAX_TEXTO: MAX_TEXTO, CREAR_TABLAS: CREAR_TABLAS };
