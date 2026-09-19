// Pruebas de la capa que escribe en las hojas.
// Uso: node prueba-escribir.js
//
// Un error acá no da error: pone el dato en la celda equivocada. Por eso se
// verifica el rango exacto y el orden de las operaciones, no solo que "corra".

const { rangoA1, aCelda } = require('./src/escribir');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

console.log('\n=== Rangos A1: Sheets cuenta desde 1 ===');
{
  chk('una celda suelta', rangoA1('SALDOS', 1, 1, 1, 1) === "'SALDOS'!A1:A1", rangoA1('SALDOS', 1, 1, 1, 1));
  chk('una fila de 3 columnas', rangoA1('SALDOS', 1, 1, 1, 3) === "'SALDOS'!A1:C1", rangoA1('SALDOS', 1, 1, 1, 3));
  chk('arrancando en la columna 4', rangoA1('SALDOS', 2, 4, 1, 2) === "'SALDOS'!D2:E2", rangoA1('SALDOS', 2, 4, 1, 2));
  chk('un bloque de 2x2 desde B3', rangoA1('X', 3, 2, 2, 2) === "'X'!B3:C4", rangoA1('X', 3, 2, 2, 2));

  // Un nombre con espacios sin comillas rompe el rango y la llamada entera.
  chk('un nombre con espacios va entre comillas',
      rangoA1('Caja Menor', 1, 1, 1, 1) === "'Caja Menor'!A1:A1", rangoA1('Caja Menor', 1, 1, 1, 1));

  // Más allá de la columna Z: la columna 27 es AA, no [.
  chk('la columna 26 es Z',  rangoA1('X', 1, 26, 1, 1) === "'X'!Z1:Z1", rangoA1('X', 1, 26, 1, 1));
  chk('la columna 27 es AA', rangoA1('X', 1, 27, 1, 1) === "'X'!AA1:AA1", rangoA1('X', 1, 27, 1, 1));
  chk('la columna 28 es AB', rangoA1('X', 1, 28, 1, 1) === "'X'!AB1:AB1", rangoA1('X', 1, 28, 1, 1));
}

console.log('\n=== Valores: las fechas NO pueden volver a guardarse como texto ===');
{
  // Costó una jornada entera dejar la hoja en fechas reales. Si esta capa
  // mandara un formato que Sheets no reconoce, volvería el problema completo
  // de dia/mes — y esta vez sobre datos nuevos.
  const d = new Date(2026, 8, 15, 18, 40, 5);   // 15/09/2026 18:40:05
  chk('una fecha sale en dd/MM/yyyy HH:mm:ss', aCelda(d) === '15/09/2026 18:40:05', aCelda(d));

  const conCeros = new Date(2026, 0, 5, 9, 5, 0);
  chk('rellena con ceros a la izquierda', aCelda(conCeros) === '05/01/2026 09:05:00', aCelda(conCeros));

  chk('un numero se manda como numero', aCelda(119900) === 119900);
  chk('un texto se manda como texto',   aCelda('AMPAC SAS') === 'AMPAC SAS');
  chk('el vacio sigue vacio',           aCelda('') === '');

  // Un importe NUNCA puede salir formateado: Sheets lo guardaria como texto y
  // dejaria de sumar.
  chk('un importe no se convierte en texto', typeof aCelda(46000) === 'number');
}

console.log('\n=== El orden de las operaciones ===');
{
  // Se verifica contra un cliente simulado: lo que importa es QUE se llama y
  // EN QUE orden, no que Google responda.
  const llamadas = [];
  const apiFalsa = {
    spreadsheets: {
      batchUpdate: async (r) => {
        const req = r.requestBody.requests[0];
        llamadas.push(req.addSheet ? 'crearHoja:' + req.addSheet.properties.title : 'borrar');
        return {};
      },
      get: async () => ({ data: { sheets: [{ properties: { sheetId: 7, title: 'S' } }] } }),
      values: {
        append:      async (r) => { llamadas.push('agregar:' + r.range); return {}; },
        batchUpdate: async (r) => { llamadas.push('escribir:' + r.requestBody.data.map(d => d.range).join(',')); return {}; }
      }
    }
  };

  const esc = require('./src/escribir');

  (async () => {
    await esc.aplicar([
      { tipo: 'crearHoja', hoja: 'Compra Materiales' },
      { tipo: 'escribir', hoja: 'Compra Materiales', fila: 1, col: 1, valores: [['A', 'B']] },
      { tipo: 'agregar',  hoja: 'Compra Materiales', valores: ['x', 1] },
      { tipo: 'escribir', hoja: 'S', fila: 2, col: 3, valores: [[9]] },
      { tipo: 'borrar',   hoja: 'S', desde: 2, cantidad: 1 },
      { tipo: 'escribir', hoja: 'S', fila: 5, col: 1, valores: [['z']] }
    ], apiFalsa, 'documento-de-prueba');

    chk('la hoja nueva se crea PRIMERO', llamadas[0] === 'crearHoja:Compra Materiales', llamadas);

    const iAgregar  = llamadas.findIndex(l => l.indexOf('agregar:') === 0);
    const iEscribe1 = llamadas.findIndex(l => l.indexOf("'Compra Materiales'!A1") !== -1);
    chk('lo escrito antes de un agregar se baja antes', iEscribe1 !== -1 && iEscribe1 < iAgregar, llamadas);

    const iBorrar   = llamadas.indexOf('borrar');
    const iEscribe2 = llamadas.findIndex(l => l.indexOf("'S'!C2") !== -1);
    const iEscribe3 = llamadas.findIndex(l => l.indexOf("'S'!A5") !== -1);
    chk('lo escrito ANTES del borrado se baja antes', iEscribe2 !== -1 && iEscribe2 < iBorrar, llamadas);
    chk('lo escrito DESPUES del borrado se baja despues', iEscribe3 > iBorrar, llamadas);

    // Formato y congelar no rompen: se ignoran sin fallar.
    llamadas.length = 0;
    await esc.aplicar([{ tipo: 'formato', hoja: 'S', fila: 1, col: 1, alto: 1, ancho: 1, negrita: true },
                       { tipo: 'congelar', hoja: 'S', filas: 1 }], apiFalsa, 'documento-de-prueba');
    chk('formato y congelar no generan escrituras', llamadas.length === 0, llamadas);

    chk('sin cambios no se llama a nada', (await esc.aplicar([], apiFalsa, 'x'), true));

    console.log('\n=== Una fila nueva cae PEGADA a los datos, no al final de la Tabla ===');
    {
      // El 19/09/2026 un pago de $100.000 quedó en la fila 1041 de una hoja
      // con 44 filas de datos. No se perdió —la app lo leía— pero para quien
      // mira la hoja había desaparecido.
      //
      // Las hojas están convertidas en Tablas de Sheets y cada Tabla abarca
      // las 1000 filas de la cuadrícula. `appendRow()` de Apps Script agrega
      // tras la última fila CON DATOS; `values.append` agrega tras la TABLA.
      // La migración cambió esa semántica sin que nadie tocara la lógica.
      const rangos = [];
      const api = {
        spreadsheets: {
          get: async () => ({ data: { sheets: [{ properties: { sheetId: 7, title: 'S' } }] } }),
          batchUpdate: async () => ({}),
          values: {
            batchUpdate: async () => ({}),
            append: async (r) => {
              rangos.push(r.range);
              // Como responde Sheets de verdad: dice dónde escribió. Acá se
              // finge que cayó donde correspondía, para no disparar el aviso.
              const m = /!A1:[A-Z]+(\d+)/.exec(r.range);
              const fila = m ? Number(m[1]) + 1 : 1;
              return { data: { updates: { updatedRange: "'x'!A" + fila + ':L' + fila } } };
            }
          }
        }
      };

      await esc.aplicar([{ tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', fila: 45,
                           valores: new Array(12).fill('x') }], api, 'doc');

      chk('el rango acota la búsqueda al bloque de datos',
          rangos[0] === "'PAGOS REGISTRADOS'!A1:L44", rangos[0]);
      chk('y NO manda la hoja entera, que es lo que la mandaba al fondo',
          rangos[0].indexOf('!') !== -1, rangos[0]);

      // Una hoja vacía no tiene bloque de datos: ahí va el nombre solo.
      rangos.length = 0;
      await esc.aplicar([{ tipo: 'agregar', hoja: 'S', fila: 1, valores: ['a'] }], api, 'doc');
      chk('una hoja sin datos usa el nombre solo', rangos[0] === "'S'", rangos[0]);
    }

    console.log('\n=== Si la fila cae en otro lado, se avisa ===');
    {
      // Que un dato quede en el lugar equivocado NO da error: la app lo sigue
      // leyendo y nadie se entera hasta que alguien mira la hoja. Por eso hay
      // que comparar dónde dijo Sheets que escribió.
      const api = {
        spreadsheets: {
          get: async () => ({ data: { sheets: [] } }),
          batchUpdate: async () => ({}),
          values: {
            batchUpdate: async () => ({}),
            // Sheets dice que escribió en la 1041, no en la 45.
            append: async () => ({ data: { updates: { updatedRange: "'PAGOS REGISTRADOS'!A1041:L1041" } } })
          }
        }
      };

      const antes = esc.filasFueraDeLugar().length;
      await esc.aplicar([{ tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', fila: 45,
                           valores: new Array(12).fill('x') }], api, 'doc');
      const reg = esc.filasFueraDeLugar();

      chk('queda registrado que cayó fuera de lugar', reg.length === antes + 1, reg.length);
      chk('con la fila esperada y la real',
          reg[0] && reg[0].esperada === 45 && reg[0].real === 1041, reg[0]);
      chk('y con la hoja', reg[0] && reg[0].hoja === 'PAGOS REGISTRADOS', reg[0]);
    }

    console.log('\n=== La copia en memoria y la hoja tienen que coincidir ===');
    {
      // La copia decía 45 y la hoja decía 1041: las dos "correctas" y ninguna
      // igual a la otra. Desde que el servidor se queda con la copia después
      // de escribir, esa diferencia se propagaría.
      const { crearLibro } = require('./src/adaptador-hojas');
      const libro = crearLibro({ 'PAGOS REGISTRADOS': [['A','B'], ['1','2'], ['3','4']] });
      libro.SpreadsheetApp.getActiveSpreadsheet()
           .getSheetByName('PAGOS REGISTRADOS').appendRow(['5','6']);

      const c = libro.cambios().filter(x => x.tipo === 'agregar')[0];
      chk('appendRow dice en qué fila quedó', c && c.fila === 4, c);
      chk('y la copia en memoria la tiene ahí',
          libro.datos()['PAGOS REGISTRADOS'][3][0] === '5',
          libro.datos()['PAGOS REGISTRADOS']);
    }

    console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
    process.exit(fallos ? 1 : 0);
  })();
}
