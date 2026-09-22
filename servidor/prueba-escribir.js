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
  // ⚠️ En ISO, no en dd/MM. El documento está en en_US: ahí "15/09/2026" pasa,
  // pero "22/09/2026" NO (no hay mes 22) y Sheets lo guarda como TEXTO, sin
  // avisar. Comprobado contra el documento real: dd/MM -> texto, ISO -> fecha.
  chk('una fecha sale en ISO yyyy-MM-dd HH:mm:ss', aCelda(d) === '2026-09-15 18:40:05', aCelda(d));
  // El caso que lo destapó: un dia mayor que 12 no puede ser un mes.
  chk('un dia > 12 tambien sale en ISO',
      aCelda(new Date(2026, 8, 22, 0, 0, 0)) === '2026-09-22 00:00:00', aCelda(new Date(2026, 8, 22, 0, 0, 0)));
  chk('NUNCA en dd/MM, que en en_US queda como texto',
      !/^\d{2}\/\d{2}\//.test(aCelda(d)), aCelda(d));

  const conCeros = new Date(2026, 0, 5, 9, 5, 0);
  chk('rellena con ceros a la izquierda', aCelda(conCeros) === '2026-01-05 09:05:00', aCelda(conCeros));

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
        llamadas.push(req.addSheet ? 'crearHoja:' + req.addSheet.properties.title
                    : req.insertDimension ? 'abrirFila' : 'borrar');
        return {};
      },
      get: async () => ({ data: { sheets: [
        { properties: { sheetId: 7, title: 'S' } },
        { properties: { sheetId: 8, title: 'Compra Materiales' } }
      ] } }),
      values: {
        update:      async (r) => { llamadas.push('agregar:' + r.range); return { data: { updatedRange: r.range } }; },
        batchUpdate: async (r) => { llamadas.push('escribir:' + r.requestBody.data.map(d => d.range).join(',')); return {}; }
      }
    }
  };

  const esc = require('./src/escribir');

  (async () => {
    await esc.aplicar([
      { tipo: 'crearHoja', hoja: 'Compra Materiales' },
      { tipo: 'escribir', hoja: 'Compra Materiales', fila: 1, col: 1, valores: [['A', 'B']] },
      { tipo: 'agregar',  hoja: 'Compra Materiales', fila: 2, valores: ['x', 1] },
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

    console.log('\n=== La fila nueva va donde la lógica dice, no donde Sheets quiera ===');
    {
      // El 19/09/2026 un pago de $100.000 quedó en la fila 1041 de una hoja
      // con 44 filas de datos. `appendRow()` de Apps Script agrega tras la
      // última fila CON DATOS; `values.append` agrega tras la TABLA, y todas
      // las hojas están convertidas en Tablas.
      //
      // ⚠️ El primer intento fue acotarle el rango a `values.append`. NO
      // SIRVE: probado agregando 1000 filas a mano, el pago siguiente volvió a
      // caer en la 1047. `append` resuelve la tabla desde el objeto Tabla e
      // IGNORA el rango que se le pasa. Por eso ya no se usa.
      const pasos = [];
      const api = {
        spreadsheets: {
          get: async () => ({ data: { sheets: [
            { properties: { sheetId: 7, title: 'S' } },
            { properties: { sheetId: 1, title: 'PAGOS REGISTRADOS' } }
          ] } }),
          batchUpdate: async (p) => {
            (p.requestBody.requests || []).forEach(r => {
              if (r.insertDimension) {
                const g = r.insertDimension.range;
                pasos.push('inserta filas ' + (g.startIndex + 1) + '-' + g.endIndex +
                           ' en hoja ' + g.sheetId);
              }
            });
            return {};
          },
          values: {
            batchUpdate: async () => ({}),
            append: async () => { pasos.push('APPEND'); return { data: {} }; },
            update: async (r) => {
              pasos.push('escribe ' + r.range);
              return { data: { updatedRange: r.range } };
            }
          }
        }
      };

      await esc.aplicar([{ tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', fila: 45,
                           valores: new Array(12).fill('x') }], api, 'doc');

      chk('NO se usa values.append', pasos.indexOf('APPEND') === -1, pasos);
      chk('primero se abre la fila exacta',
          pasos[0] === 'inserta filas 45-45 en hoja 1', pasos[0]);
      chk('y después se escribe en esa fila',
          pasos[1] === "escribe 'PAGOS REGISTRADOS'!A45:L45", pasos[1]);

      // Insertar y no sobrescribir es lo que hace que dos pagos simultáneos
      // no se pisen: el segundo empuja al primero, ninguno se pierde.
      chk('se INSERTA la fila, no se pisa la que hubiera',
          pasos[0].indexOf('inserta') === 0, pasos);

      // Varias filas seguidas de la misma hoja: un solo par de llamadas.
      pasos.length = 0;
      await esc.aplicar([
        { tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', fila: 45, valores: ['a'] },
        { tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', fila: 46, valores: ['b'] },
        { tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', fila: 47, valores: ['c'] }
      ], api, 'doc');
      chk('tres filas seguidas = un solo par de llamadas', pasos.length === 2, pasos);
      chk('se abren las tres de una vez',
          pasos[0] === 'inserta filas 45-47 en hoja 1', pasos[0]);
      chk('y se escriben juntas',
          pasos[1] === "escribe 'PAGOS REGISTRADOS'!A45:A47", pasos[1]);

      // Sin fila no se escribe a ciegas.
      let fallo = null;
      try {
        await esc.aplicar([{ tipo: 'agregar', hoja: 'PAGOS REGISTRADOS', valores: ['x'] }], api, 'doc');
      } catch (err) { fallo = err; }
      chk('sin saber la fila, falla en voz alta en vez de adivinar',
          !!fallo && /No se escribió nada/.test(fallo.message), fallo && fallo.message);
    }

    console.log('\n=== Si la fila cae en otro lado, se avisa ===');
    {
      // Que un dato quede en el lugar equivocado NO da error: la app lo sigue
      // leyendo y nadie se entera hasta que alguien mira la hoja. Por eso hay
      // que comparar dónde dijo Sheets que escribió.
      const api = {
        spreadsheets: {
          get: async () => ({ data: { sheets: [{ properties: { sheetId: 1, title: 'PAGOS REGISTRADOS' } }] } }),
          batchUpdate: async () => ({}),
          values: {
            batchUpdate: async () => ({}),
            // Sheets dice que escribió en la 1041, no en la 45.
            update: async () => ({ data: { updatedRange: "'PAGOS REGISTRADOS'!A1041:L1041" } })
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

    console.log('\n=== La cuadrícula se agranda sola, como en Apps Script ===');
    {
      // El 21/09/2026 una usuaria no pudo registrar un pago: la lógica quiso
      // crear la columna ID REGISTRO en la 27 de una hoja de 26 y Sheets
      // respondió "Range (Viaticos!AA1) exceeds grid limits". Apps Script
      // agrandaba la hoja solo; la API no.
      const pasos = [];
      let rechazos = 1;   // la primera escritura se rechaza por tamaño
      const api = {
        spreadsheets: {
          get: async () => { pasos.push('meta'); return { data: { sheets: [
            { properties: { sheetId: 5, title: 'Viaticos', gridProperties: { rowCount: 68, columnCount: 26 } } }
          ] } }; },
          batchUpdate: async (p) => {
            (p.requestBody.requests || []).forEach(r => {
              if (r.appendDimension) pasos.push('agranda ' + r.appendDimension.dimension + ' +' + r.appendDimension.length);
            });
            return {};
          },
          values: {
            batchUpdate: async (p) => {
              if (rechazos-- > 0) {
                pasos.push('rechazo');
                throw new Error("Invalid data[0]: Range (Viaticos!AA1) exceeds grid limits. Max rows: 68, max columns: 26");
              }
              pasos.push('escribe ' + p.requestBody.data.map(d => d.range).join(','));
              return {};
            },
            update: async () => ({ data: {} })
          }
        }
      };

      // El encabezado nuevo en la columna 27 (AA).
      let fallo = null;
      try {
        await esc.aplicar([{ tipo: 'escribir', hoja: 'Viaticos', fila: 1, col: 27, valores: [['ID REGISTRO']] }], api, 'doc');
      } catch (err) { fallo = err; }
      chk('la escritura fuera de la cuadrícula NO termina en error', fallo === null, fallo && fallo.message);

      chk('primero intenta escribir sin preguntar el tamaño (no gasta cuota de más)',
          pasos[0] === 'rechazo', pasos);
      chk('ante el rechazo por tamaño, agranda lo justo: 1 columna',
          pasos.indexOf('agranda COLUMNS +1') !== -1, pasos);
      chk('no agranda filas que no hacen falta',
          !pasos.some(x => /agranda ROWS/.test(x)), pasos);
      chk('y reintenta la MISMA escritura',
          pasos[pasos.length - 1] === "escribe 'Viaticos'!AA1:AA1", pasos);

      // Filas también: escribir en la 69 de una hoja de 68.
      pasos.length = 0; rechazos = 1;
      try {
        await esc.aplicar([{ tipo: 'escribir', hoja: 'Viaticos', fila: 69, col: 1, valores: [['x', 'y']] }], api, 'doc');
      } catch (err) { /* lo reporta la comprobación de abajo */ }
      chk('con filas pasa lo mismo: agranda 1 fila',
          pasos.indexOf('agranda ROWS +1') !== -1, pasos);

      // Un error que NO es de tamaño no se reintenta ni se disfraza.
      pasos.length = 0; rechazos = 0;
      api.spreadsheets.values.batchUpdate = async () => { throw new Error('The caller does not have permission'); };
      let otro = null;
      try { await esc.aplicar([{ tipo: 'escribir', hoja: 'Viaticos', fila: 1, col: 1, valores: [['x']] }], api, 'doc'); }
      catch (err) { otro = err; }
      chk('un error que no es de tamaño se deja pasar tal cual',
          otro && /permission/.test(otro.message), otro && otro.message);
      chk('y no se agranda nada', !pasos.some(x => /agranda/.test(x)), pasos);
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
