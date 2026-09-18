// Pruebas del adaptador de hojas.
// Uso: node prueba-adaptador.js
//
// Lo que importa acá no es que "funcione", sino que se comporte EXACTAMENTE
// como Apps Script. Cualquier diferencia se traduce en un número equivocado en
// la contabilidad, y esa clase de fallo no da error: da un dato malo.

const { crearLibro, rectanguloConDatos } = require('./src/adaptador-hojas');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

const ENC = ['FECHA REGISTRO', 'EMPRESA', 'VALOR'];
const foto = () => ({
  'PAGOS REGISTRADOS': [ENC.slice(), ['2026-09-17 10:00', 'AMPAC SAS', 1000]],
  'Viaticos':          [ENC.slice()],
  'SALDOS':            [['FECHA', 'CUENTA', 'SALDO BASE']]
});

console.log('\n=== Lectura: el rectangulo con datos ===');
{
  const l = crearLibro(foto());
  const h = l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PAGOS REGISTRADOS');

  chk('getDataRange devuelve encabezado + filas', h.getDataRange().getValues().length === 2);
  chk('getLastRow cuenta las filas con datos',    h.getLastRow() === 2, h.getLastRow());
  chk('getLastColumn cuenta las columnas',        h.getLastColumn() === 3, h.getLastColumn());
  chk('una hoja solo con encabezado da 1 fila',
      l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Viaticos').getLastRow() === 1);

  // Las filas vacias del final NO cuentan: Sheets suele traerlas y si se
  // contaran, appendRow dejaria un hueco y getLastRow mentiria.
  const conVacias = crearLibro({ 'X': [['a'], ['b'], ['', ''], ['']] });
  const hx = conVacias.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('X');
  chk('las filas vacias del final se descartan', hx.getLastRow() === 2, hx.getLastRow());

  chk('una hoja que no existe devuelve null',
      l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NO EXISTE') === null);
}

console.log('\n=== getRange: se cuenta desde 1, no desde 0 ===');
{
  const l = crearLibro(foto());
  const h = l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PAGOS REGISTRADOS');

  // Equivocarse en esto desplaza TODO un lugar sin que nada falle.
  chk('getRange(1,1,1,3) trae el encabezado completo',
      JSON.stringify(h.getRange(1, 1, 1, 3).getValues()) === JSON.stringify([ENC]),
      h.getRange(1, 1, 1, 3).getValues());
  chk('getRange(2,2) trae la celda de la fila 2, columna 2',
      h.getRange(2, 2).getValues()[0][0] === 'AMPAC SAS', h.getRange(2, 2).getValues());
  chk('pedir mas alla del final devuelve vacio, no rompe',
      h.getRange(99, 1, 1, 2).getValues()[0][0] === '', h.getRange(99, 1, 1, 2).getValues());
}

console.log('\n=== Escritura: se ve en el acto y queda anotada ===');
{
  const l = crearLibro(foto());
  const libro = l.SpreadsheetApp.getActiveSpreadsheet();
  const h = libro.getSheetByName('PAGOS REGISTRADOS');

  h.appendRow(['2026-09-18 09:00', 'Millennium Co', 2000]);

  // Leer despues de escribir TIENE que ver el dato nuevo. Si no, una funcion
  // que escribe y relee calcula sobre datos viejos y da un numero equivocado.
  chk('appendRow se ve al releer en la misma peticion', h.getLastRow() === 3, h.getLastRow());
  chk('y el dato es el correcto',
      h.getDataRange().getValues()[2][1] === 'Millennium Co',
      h.getDataRange().getValues()[2]);
  chk('queda anotado para escribir de verdad',
      l.cambios().filter(c => c.tipo === 'agregar').length === 1, l.cambios());

  h.getRange(2, 3).setValue(9999);
  chk('setValue cambia la celda', h.getDataRange().getValues()[1][2] === 9999);
  chk('setValue queda anotado',
      l.cambios().filter(c => c.tipo === 'escribir').length === 1, l.cambios());

  h.getRange(1, 1, 1, 3).setValues([['A', 'B', 'C']]);
  chk('setValues escribe desde la fila y columna pedidas',
      JSON.stringify(h.getDataRange().getValues()[0]) === JSON.stringify(['A', 'B', 'C']),
      h.getDataRange().getValues()[0]);

  // Escribir en una columna nueva no puede borrar las que ya estaban: ese
  // error ya aparecio dos veces en el banco de pruebas de este proyecto.
  const l2 = crearLibro(foto());
  const h2 = l2.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PAGOS REGISTRADOS');
  h2.getRange(1, 4, 1, 1).setValues([['ID REGISTRO']]);
  chk('agregar una columna NO borra las anteriores',
      JSON.stringify(h2.getDataRange().getValues()[0]) === JSON.stringify(ENC.concat(['ID REGISTRO'])),
      h2.getDataRange().getValues()[0]);
}

console.log('\n=== appendRow se apoya en las filas con datos ===');
{
  // Si appendRow usara el largo del arreglo en vez del rectangulo con datos,
  // una hoja con filas vacias al final dejaria un hueco en el medio.
  const l = crearLibro({ 'X': [['a'], ['b'], ['', ''], ['', '']] });
  const h = l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('X');
  h.appendRow(['c']);
  chk('la fila nueva queda pegada a la ultima con datos',
      h.getDataRange().getValues().length === 3 && h.getDataRange().getValues()[2][0] === 'c',
      h.getDataRange().getValues());
}

console.log('\n=== Borrar filas ===');
{
  const l = crearLibro({ 'S': [['h'], ['a'], ['b'], ['c']] });
  const h = l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('S');

  h.deleteRow(2);   // borra 'a'
  chk('deleteRow saca la fila pedida (contando desde 1)',
      JSON.stringify(h.getDataRange().getValues().map(f => f[0])) === JSON.stringify(['h', 'b', 'c']),
      h.getDataRange().getValues());
  chk('queda anotado', l.cambios().filter(c => c.tipo === 'borrar').length === 1);

  h.deleteRows(2, 2);   // borra 'b' y 'c'
  chk('deleteRows saca varias', h.getDataRange().getValues().length === 1, h.getDataRange().getValues());
}

console.log('\n=== Crear hojas ===');
{
  const l = crearLibro(foto());
  const libro = l.SpreadsheetApp.getActiveSpreadsheet();
  const antes = libro.getNumSheets();

  const nueva = libro.insertSheet('Compra Materiales');
  nueva.appendRow(['FECHA REGISTRO', 'EMPRESA']);

  chk('la hoja nueva existe',        libro.getSheetByName('Compra Materiales') !== null);
  chk('y suma al total',             libro.getNumSheets() === antes + 1, libro.getNumSheets());
  chk('se puede escribir en ella',   libro.getSheetByName('Compra Materiales').getLastRow() === 1);
  chk('queda anotada para crearla de verdad',
      l.cambios().filter(c => c.tipo === 'crearHoja').length === 1, l.cambios());
  chk('getSheets la incluye',
      libro.getSheets().map(h => h.getName()).indexOf('Compra Materiales') !== -1);
}

console.log('\n=== La foto original no se toca ===');
{
  // La foto puede venir de un cache compartido entre peticiones. Si la logica
  // la mutara, una peticion le ensuciaria los datos a la siguiente.
  const original = foto();
  const l = crearLibro(original);
  l.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PAGOS REGISTRADOS')
   .appendRow(['x', 'y', 1]);

  chk('la foto de entrada queda intacta',
      original['PAGOS REGISTRADOS'].length === 2, original['PAGOS REGISTRADOS'].length);
  chk('pero la copia interna si cambio',
      l.datos()['PAGOS REGISTRADOS'].length === 3, l.datos()['PAGOS REGISTRADOS'].length);
}

console.log('\n=== Lo que Apps Script necesita que exista ===');
{
  const l = crearLibro(foto());
  const libro = l.SpreadsheetApp.getActiveSpreadsheet();
  chk('flush() existe y no rompe', (l.SpreadsheetApp.flush(), true));
  chk('getId devuelve algo',       typeof libro.getId() === 'string');
  chk('getUrl arma la direccion',  libro.getUrl().indexOf('docs.google.com') !== -1, libro.getUrl());
  chk('getSpreadsheetTimeZone responde', typeof libro.getSpreadsheetTimeZone() === 'string');
  chk('setFrozenRows no rompe y queda anotado',
      (libro.getSheetByName('Viaticos').setFrozenRows(1),
       l.cambios().filter(c => c.tipo === 'congelar').length === 1));
  chk('setValues(...).setFontWeight encadena como en Apps Script',
      (libro.getSheetByName('Viaticos').getRange(1, 1, 1, 1).setValues([['x']]).setFontWeight('bold'), true));
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
