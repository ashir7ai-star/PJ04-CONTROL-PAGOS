// Adaptador: le da a `apps-script.gs` el `SpreadsheetApp` que espera, pero
// respaldado por una FOTO de las hojas traída con la API de Sheets.
//
// ─── El problema que resuelve ─────────────────────────────────────────────
//
// `apps-script.gs` lee las hojas de forma SÍNCRONA (`getValues()` devuelve los
// datos en el acto). La API de Sheets es asíncrona y no hay manera de volverla
// síncrona sin trucos frágiles.
//
// La salida no es pelear contra eso, sino cambiar el momento: se traen TODAS
// las hojas de una sola vez ANTES de ejecutar la lógica, y esta trabaja contra
// esa foto en memoria. Las escrituras se anotan en una lista y se aplican
// DESPUÉS, en una sola operación.
//
// Resultado: exactamente 2 llamadas HTTP por petición —una para leer, otra
// para escribir— sin importar cuántas veces la lógica toque las hojas. Antes,
// con Apps Script, cada lectura era un viaje: once o más por petición.
//
// ─── Lo que hay que respetar ──────────────────────────────────────────────
//
// Las escrituras se aplican también a la foto, en el momento. Si no, una
// función que escribe y vuelve a leer vería datos viejos, y eso no da error:
// da un número equivocado. Esa clase de fallo silencioso ya costó caro en este
// proyecto.
//
// El contrato que implementa esto no es inventado: sale de lo que las 4 suites
// de pruebas vienen simulando desde hace meses (`hojaFalsa`).

// Recorta una matriz al rectángulo con datos, como hace getDataRange().
function rectanguloConDatos(filas) {
  let ultimaFila = 0, ultimaCol = 0;
  filas.forEach((fila, i) => {
    (fila || []).forEach((v, j) => {
      if (v !== '' && v !== null && v !== undefined) {
        if (i + 1 > ultimaFila) ultimaFila = i + 1;
        if (j + 1 > ultimaCol)  ultimaCol  = j + 1;
      }
    });
  });
  const salida = [];
  for (let i = 0; i < ultimaFila; i++) {
    const fila = filas[i] || [];
    const nueva = [];
    for (let j = 0; j < ultimaCol; j++) nueva.push(fila[j] === undefined ? '' : fila[j]);
    salida.push(nueva);
  }
  return salida;
}

function crearLibro(foto) {
  // Copia propia: la lógica va a mutar esto y no queremos tocar lo que nos
  // pasaron, que puede venir de un caché compartido.
  const datos = {};
  Object.keys(foto || {}).forEach(n => {
    datos[n] = (foto[n] || []).map(f => (f || []).slice());
  });

  const orden   = Object.keys(datos);
  const cambios = [];

  function hoja(nombre) {
    const filas = () => datos[nombre];

    const api = {
      getName: () => nombre,

      getDataRange: () => ({
        getValues: () => rectanguloConDatos(filas())
      }),

      getLastRow:    () => rectanguloConDatos(filas()).length,
      getLastColumn: () => (rectanguloConDatos(filas())[0] || []).length,

      // Apps Script cuenta filas y columnas desde 1, no desde 0. Equivocarse
      // acá desplaza todo un lugar sin que nada falle.
      getRange: (fila, col, nFilas, nCols) => {
        const alto  = nFilas || 1;
        const ancho = nCols  || 1;
        return {
          getValues: () => {
            const salida = [];
            for (let i = 0; i < alto; i++) {
              const f = filas()[fila - 1 + i] || [];
              const r = [];
              for (let j = 0; j < ancho; j++) r.push(f[col - 1 + j] === undefined ? '' : f[col - 1 + j]);
              salida.push(r);
            }
            return salida;
          },
          setValues: (valores) => {
            valores.forEach((f, i) => {
              if (!filas()[fila - 1 + i]) filas()[fila - 1 + i] = [];
              f.forEach((v, j) => { filas()[fila - 1 + i][col - 1 + j] = v; });
            });
            cambios.push({ tipo: 'escribir', hoja: nombre, fila: fila, col: col, valores: valores });
            return { setFontWeight: (peso) => { cambios.push({ tipo: 'formato', hoja: nombre, fila, col, alto, ancho, negrita: peso === 'bold' }); } };
          },
          setValue: (v) => {
            if (!filas()[fila - 1]) filas()[fila - 1] = [];
            filas()[fila - 1][col - 1] = v;
            cambios.push({ tipo: 'escribir', hoja: nombre, fila: fila, col: col, valores: [[v]] });
          },
          setFontWeight: (peso) => {
            cambios.push({ tipo: 'formato', hoja: nombre, fila, col, alto, ancho, negrita: peso === 'bold' });
          }
        };
      },

      appendRow: (fila) => {
        // Se agrega al final del rectángulo CON DATOS, no al final del arreglo:
        // una hoja puede traer filas vacías al final y ahí la fila nueva
        // quedaría flotando lejos, con un hueco en el medio.
        const usadas = rectanguloConDatos(filas()).length;
        datos[nombre][usadas] = fila.slice();
        cambios.push({ tipo: 'agregar', hoja: nombre, valores: fila.slice() });
      },

      deleteRow:  (n)         => { filas().splice(n - 1, 1); cambios.push({ tipo: 'borrar', hoja: nombre, desde: n, cantidad: 1 }); },
      deleteRows: (n, cuántas) => { filas().splice(n - 1, cuántas); cambios.push({ tipo: 'borrar', hoja: nombre, desde: n, cantidad: cuántas }); },

      setFrozenRows: (n) => { cambios.push({ tipo: 'congelar', hoja: nombre, filas: n }); }
    };
    return api;
  }

  const libro = {
    getSheets:      () => orden.map(n => hoja(n)),
    getSheetByName: (n) => (Object.prototype.hasOwnProperty.call(datos, n) ? hoja(n) : null),
    getNumSheets:   () => orden.length,
    insertSheet:    (n) => {
      datos[n] = [];
      orden.push(n);
      cambios.push({ tipo: 'crearHoja', hoja: n });
      return hoja(n);
    },
    getName: () => crearLibro.nombreDocumento || 'CONTROL DE PAGOS',
    getId:   () => process.env.SHEETS_ID || '',
    getUrl:  () => 'https://docs.google.com/spreadsheets/d/' + (process.env.SHEETS_ID || '') + '/edit',
    getSpreadsheetTimeZone: () => process.env.ZONA_HORARIA || 'America/Bogota'
  };

  return {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => libro,
      // En Apps Script obliga a bajar los cambios pendientes. Acá no hay nada
      // que bajar hasta el final, así que no hace falta hacer nada — pero la
      // función tiene que existir o el código explota al llamarla.
      flush: () => {},
      create: (n) => { datos[n] = []; orden.push(n); cambios.push({ tipo: 'crearHoja', hoja: n }); return libro; }
    },
    // Lo que hay que aplicar a las hojas reales cuando la lógica termine.
    cambios: () => cambios.slice(),
    // La foto ya con los cambios aplicados: sirve para verificar en pruebas.
    datos: () => datos
  };
}

module.exports = { crearLibro, rectanguloConDatos };
