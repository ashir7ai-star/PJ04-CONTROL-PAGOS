// Convierte las fechas que devuelve la API de Sheets en objetos Date reales.
//
// ─── Por qué hace falta ───────────────────────────────────────────────────
//
// `apps-script.gs` pregunta `valor instanceof Date` en todos lados para decidir
// si una celda es una fecha de verdad o un texto. Apps Script se lo daba hecho.
// La API no: devuelve las fechas como "número de serie" (días desde el
// 30/12/1899), que es un número común y corriente.
//
// ─── Por qué no se puede adivinar ─────────────────────────────────────────
//
// Un serial de 46000 y un pago de 46.000 pesos son el MISMO número. No hay
// forma de distinguirlos mirando el valor. Por eso la conversión se hace solo
// en las columnas que el propio código declara como de fecha, por nombre de
// encabezado. Adivinar convertiría importes en fechas del año 2025 sin que
// nada fallara.
//
// La alternativa —pedirle a la API el texto ya formateado— depende del idioma
// del documento, y de ahí salió el problema de día/mes que costó una jornada.

// Columnas de fecha, tomadas de las que declara `apps-script.gs`.
const COLUMNAS_FECHA = [
  'FECHA REGISTRO', 'FECHA SOLICITUD', 'FECHA DECISION', 'ULTIMO ACCESO',
  'FECHA DE PAGO', 'FECHA'
];

function esColumnaDeFecha(encabezado) {
  return COLUMNAS_FECHA.indexOf(String(encabezado || '').trim().toUpperCase()) !== -1;
}

// Qué hora de pared muestra una zona para un instante dado.
function paredEnZona(instante, zona) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const p = {};
  f.formatToParts(instante).forEach(x => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

// Instante real que corresponde a una hora de pared en una zona.
//
// Se resuelve en dos pasos porque el desfase depende de la fecha (horario de
// verano). Colombia no lo usa, pero escribirlo bien cuesta tres líneas y evita
// un error imposible de encontrar si algún día se opera en otro país.
function instanteDeParedEnZona(ms, zona) {
  let aprox = ms - (paredEnZona(new Date(ms), zona) - ms);
  aprox     = ms - (paredEnZona(new Date(aprox), zona) - aprox);
  return new Date(aprox);
}

// Número de serie de Sheets → Date.
//
// El 0 de Sheets es el 30/12/1899. La parte entera son días y la decimal, la
// fracción del día. Se redondea al segundo: la aritmética de coma flotante
// deja restos (18:40 sale como 18:39:59,9999) y truncar convertiría un minuto
// en el anterior.
function serieADate(serie, zona) {
  const n = Number(serie);
  if (!isFinite(n)) return null;

  const MS_DIA = 86400000;
  const msUTC  = Math.round((n - 25569) * MS_DIA / 1000) * 1000;
  return instanteDeParedEnZona(msUTC, zona || 'America/Bogota');
}

// Convierte la foto de las hojas: donde el encabezado dice que hay una fecha y
// la celda trae un número, queda un Date.
//
// Lo que NO es número se deja igual: durante la migración conviven filas
// viejas guardadas como texto, y el código ya sabe interpretarlas.
function convertirFoto(foto, zona) {
  const salida = {};

  Object.keys(foto || {}).forEach(nombre => {
    const filas = foto[nombre] || [];
    if (!filas.length) { salida[nombre] = []; return; }

    const encabezados = (filas[0] || []).map(h => String(h));
    const esFecha = encabezados.map(esColumnaDeFecha);

    salida[nombre] = filas.map((fila, i) => {
      if (i === 0) return (fila || []).slice();   // el encabezado nunca se toca
      return (fila || []).map((celda, j) => {
        if (!esFecha[j]) return celda;
        if (typeof celda !== 'number') return celda;
        // Un 0 en una columna de fecha es una celda vacía, no el 30/12/1899.
        if (celda === 0) return '';
        return serieADate(celda, zona);
      });
    });
  });

  return salida;
}

module.exports = { convertirFoto, serieADate, esColumnaDeFecha, COLUMNAS_FECHA };
