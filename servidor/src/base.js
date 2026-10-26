// La conexión a Postgres. SOLO la usa el panel de mensajes.
//
// ─── Qué pasa si no está configurada ──────────────────────────────────────
//
// Nada. El módulo no lanza al importarse y el servidor arranca igual: lo que
// queda sin funcionar es el chat, y el resto del sistema —pagos, saldos,
// viáticos, aprobaciones— sigue intacto porque vive en el Sheet.
//
// Es a propósito. Una variable de entorno mal pegada no puede dejar a la
// empresa sin poder registrar un pago. El servidor lo dice en /salud y en
// /diagnostico en vez de morir al arrancar.

let pool = null;
let motivo = '';

function disponible() {
  return !!process.env.MENSAJES_DB_URL;
}

function traerPool() {
  if (pool) return pool;
  if (!disponible()) {
    motivo = 'Falta MENSAJES_DB_URL.';
    throw new Error('El panel de mensajes no está configurado en este servidor.');
  }
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.MENSAJES_DB_URL,
    // El chat hace consultas chicas y frecuentes. Un puñado de conexiones
    // alcanza y sobra, y así no se le come el cupo de conexiones a la base,
    // que está compartida con otros proyectos del mismo servidor.
    max: Number(process.env.MENSAJES_DB_MAX || 4),
    idleTimeoutMillis: 30000,
    // Sin esto, una base que no responde deja la petición colgada y el usuario
    // ve la app congelada sin saber por qué.
    connectionTimeoutMillis: Number(process.env.MENSAJES_DB_TIMEOUT_MS || 5000)
  });
  // Una conexión que se cae estando ociosa emite 'error'. Sin este manejador,
  // Node tumba el proceso entero: el chat se llevaría puesto al servidor.
  pool.on('error', function (err) {
    console.error('[base] conexión ociosa caída:', err && err.message);
  });
  return pool;
}

async function consulta(sql, params) {
  return traerPool().query(sql, params);
}

// Para /diagnostico: comprueba de verdad, no supone.
async function estado() {
  if (!disponible()) return { ok: false, error: 'Falta MENSAJES_DB_URL.' };
  try {
    const r = await consulta('SELECT 1 AS uno');
    return { ok: r.rows[0].uno === 1 };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function cerrar() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { consulta, disponible, estado, cerrar, motivo: function () { return motivo; } };
