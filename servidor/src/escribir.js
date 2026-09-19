// Aplica a las hojas reales los cambios que la lógica fue anotando.
//
// Se ejecuta al final de la petición, cuando la lógica ya terminó. Si algo
// falló a mitad de camino, no se llega hasta acá y no se escribe nada: la hoja
// no queda a medias.
//
// ⚠️ El ORDEN importa y no se puede reordenar por eficiencia. Si la lógica
// creó una hoja y después escribió en ella, crearla después sería un error. Y
// si borró filas y después escribió por número de fila, cambiar el orden
// escribiría en la fila equivocada — sin fallar, con un dato en el lugar de
// otro.

const { google } = require('googleapis');

const { idDocumento } = require('./credenciales');
const cupo = require('./cupo-lecturas');

let clienteCache = null;
async function cliente() {
  if (clienteCache) return clienteCache;
  
  const auth = new google.auth.GoogleAuth({
    credentials: require('./credenciales').credenciales(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  clienteCache = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return clienteCache;
}

// Los valores van tal cual salieron de la lógica. Un Date se manda como texto
// ISO y Sheets lo guarda como FECHA REAL gracias a USER_ENTERED — que es
// justo lo que costó una jornada conseguir: nada de fechas como texto.
function aCelda(v) {
  if (v instanceof Date) {
    // Sin zona: se manda la hora de pared y el documento la interpreta con SU
    // zona horaria, que es como venía funcionando con Apps Script.
    const p = n => String(n).padStart(2, '0');
    return p(v.getDate()) + '/' + p(v.getMonth() + 1) + '/' + v.getFullYear() +
           ' ' + p(v.getHours()) + ':' + p(v.getMinutes()) + ':' + p(v.getSeconds());
  }
  return v;
}

function letraDeColumna(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function rangoA1(hoja, fila, col, alto, ancho) {
  const nombre = "'" + String(hoja).replace(/'/g, "''") + "'";
  return nombre + '!' + letraDeColumna(col) + fila + ':' + letraDeColumna(col + ancho - 1) + (fila + alto - 1);
}

// ─── Filas que caen donde no deben ────────────────────────────────────────
//
// `values.append` devuelve en qué rango escribió. Comparar eso con la fila
// que calculó la lógica es la única forma de enterarse de que un dato quedó
// en el lugar equivocado: no da error, no falla nada, y la app lo sigue
// leyendo igual. Así pasó desapercibido que un pago estaba en la fila 1041.
let fueraDeLugar = [];

function filaDelRango(rango) {
  const m = /![A-Z]+(\d+)/.exec(String(rango || ''));
  return m ? Number(m[1]) : null;
}

function verificarFila(hoja, esperada, respuesta) {
  if (!esperada || !respuesta) return;
  const real = filaDelRango(respuesta.updates && respuesta.updates.updatedRange);
  if (!real || real === esperada) return;

  console.warn('[fila fuera de lugar] "' + hoja + '": se esperaba la fila ' + esperada +
               ' y cayó en la ' + real + '. Revisá si la hoja es una Tabla de Sheets ' +
               'con filas vacías de sobra (node limpiar-filas-vacias.js).');

  fueraDeLugar.unshift({ cuando: new Date().toISOString(), hoja: hoja, esperada: esperada, real: real });
  fueraDeLugar.length = Math.min(fueraDeLugar.length, 10);
}

function filasFueraDeLugar() { return fueraDeLugar.slice(); }

// Aplica los cambios, en orden.
//
// `apiInyectada` e `idInyectado` existen para las pruebas: permiten verificar
// QUE se llama y EN QUE orden sin depender de la red ni de credenciales. Un
// error de orden acá no falla, escribe en la fila equivocada.
async function aplicar(cambios, apiInyectada, idInyectado) {
  if (!cambios || !cambios.length) return;

  const api = apiInyectada || await cliente();
  const id  = idInyectado  || idDocumento();

  // El id numérico de cada pestaña, preguntado UNA sola vez.
  //
  // Antes se preguntaba por cada fila a borrar. Con 867 filas eso eran 867
  // lecturas de cuota, para una respuesta que no cambia durante la petición.
  let metaHojas = null;
  const idDeHoja = async (nombre) => {
    if (!metaHojas) {
      cupo.anotar();
      const meta = await api.spreadsheets.get({
        spreadsheetId: id, fields: 'sheets.properties(sheetId,title)'
      });
      metaHojas = {};
      (meta.data.sheets || []).forEach(x => { metaHojas[x.properties.title] = x.properties.sheetId; });
    }
    return Object.prototype.hasOwnProperty.call(metaHojas, nombre) ? metaHojas[nombre] : null;
  };

  // Primero las hojas nuevas: no se puede escribir en algo que no existe.
  const nuevas = cambios.filter(c => c.tipo === 'crearHoja').map(c => c.hoja);
  if (nuevas.length) {
    cupo.anotarEscritura();
    await api.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: nuevas.map(n => ({ addSheet: { properties: { title: n } } })) }
    });
  }

  // Después el resto, respetando el orden en que la lógica los produjo.
  //
  // Las escrituras contiguas se agrupan en una sola llamada; un borrado o una
  // hoja nueva cortan el grupo, porque cambian el mapa de filas y aplicarlos
  // fuera de orden pondría datos en el lugar equivocado.
  let grupo = [];
  const bajarGrupo = async () => {
    if (!grupo.length) return;
    cupo.anotarEscritura();
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        // USER_ENTERED hace que Sheets interprete el valor como si alguien lo
        // hubiera tecleado: una fecha queda como FECHA REAL, no como texto.
        valueInputOption: 'USER_ENTERED',
        data: grupo
      }
    });
    grupo = [];
  };

  // ─── Los borrados se bajan JUNTOS ────────────────────────────────────────
  //
  // Acá estuvo el problema que tiró la app el 19/09/2026. La hoja SESIONES
  // tenía 884 filas de las que **867 estaban vacías** (quedaron al convertirla
  // en Tabla). `limpiarSesionesVencidas_` las borra —correcto: son basura—
  // pero las borra **de a una**, y cada `deleteRow` acá costaba DOS llamadas a
  // la API: un `spreadsheets.get` para averiguar el id de la hoja y un
  // `batchUpdate` para borrar.
  //
  // O sea ~867 lecturas y ~867 escrituras **en un solo ingreso**, contra un
  // límite de 60 por minuto de cada tipo. En Apps Script esto era lento; acá
  // agota la cuota de toda la empresa.
  //
  // La corrección no cambia el ORDEN ni el significado: un `batchUpdate`
  // aplica sus pedidos en secuencia, exactamente igual que mandarlos de a uno.
  // Solo deja de gastar una llamada HTTP por fila.
  let porBorrar = [];
  const bajarBorrados = async () => {
    if (!porBorrar.length) return;

    // Filas contiguas → un solo pedido. Como la lógica borra de abajo hacia
    // arriba, 867 filas seguidas se vuelven UN rango.
    //
    // ⚠️ No se reordena nada: dos borrados fuera de orden borran filas
    // distintas, porque cada uno corre las de abajo. Solo se fusiona lo que ya
    // venía pegado.
    const rangos = [];
    for (const b of porBorrar) {
      const ult = rangos[rangos.length - 1];
      if (ult && ult.hoja === b.hoja && b.desde + b.cantidad === ult.desde) {
        ult.desde = b.desde;
        ult.cantidad += b.cantidad;
      } else {
        rangos.push({ hoja: b.hoja, desde: b.desde, cantidad: b.cantidad });
      }
    }

    const requests = [];
    for (const r of rangos) {
      const hojaId = await idDeHoja(r.hoja);
      if (hojaId === null) continue;
      requests.push({ deleteDimension: { range: {
        sheetId: hojaId, dimension: 'ROWS',
        startIndex: r.desde - 1, endIndex: r.desde - 1 + r.cantidad
      } } });
    }

    porBorrar = [];
    if (!requests.length) return;

    cupo.anotarEscritura();
    await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: requests } });
  };

  for (const c of cambios) {
    if (c.tipo === 'crearHoja' || c.tipo === 'formato' || c.tipo === 'congelar') continue;

    // Un borrado corta el grupo de escrituras (cambia el mapa de filas), pero
    // se acumula con los borrados que vengan pegados.
    if (c.tipo === 'borrar') {
      await bajarGrupo();
      porBorrar.push({ hoja: c.hoja, desde: c.desde, cantidad: c.cantidad });
      continue;
    }

    // Cualquier otra cosa cierra el grupo de borrados pendiente.
    await bajarBorrados();

    if (c.tipo === 'agregar') {
      await bajarGrupo();
      cupo.anotarEscritura();

      // ─── Dónde cae una fila nueva ────────────────────────────────────────
      //
      // El 19/09/2026 un pago de $100.000 quedó en la fila 1041 de una hoja
      // con 44 filas de datos. No se perdió —la app lo leía— pero para quien
      // mira la hoja había desaparecido. En contabilidad eso es casi tan
      // grave como perderlo.
      //
      // La causa: las hojas están convertidas en **Tablas de Sheets**, y cada
      // Tabla abarca las 1000 filas de la cuadrícula.
      //
      //   · `appendRow()` de Apps Script agrega tras la última fila CON DATOS.
      //   · `values.append` agrega tras la TABLA.
      //
      // La migración cambió esa semántica sin que nadie tocara la lógica.
      //
      // El rango que se manda acota dónde busca la API: dándole el bloque de
      // datos (A1 hasta la fila anterior), la fila nueva cae pegada a los
      // datos aunque la Tabla siga siendo enorme.
      //
      // Se mantiene INSERT_ROWS a propósito: INSERTA en vez de sobrescribir,
      // así dos pagos simultáneos nunca pueden pisarse.
      const nombreHoja = "'" + String(c.hoja).replace(/'/g, "''") + "'";
      const ancho = Math.max(1, (c.valores || []).length);
      const rango = (c.fila && c.fila > 1)
        ? nombreHoja + '!A1:' + letraDeColumna(ancho) + (c.fila - 1)
        : nombreHoja;

      const r = await api.spreadsheets.values.append({
        spreadsheetId: id,
        range: rango,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [c.valores.map(aCelda)] }
      });

      // Y se comprueba dónde cayó de verdad. Sin esta comprobación, que la
      // fila termine en el lugar equivocado NO da error: la app la sigue
      // leyendo y nadie se entera hasta que alguien mira la hoja.
      verificarFila(c.hoja, c.fila, r && r.data);
      continue;
    }

    if (c.tipo === 'escribir') {
      const alto  = c.valores.length;
      const ancho = c.valores[0].length;
      grupo.push({
        range: rangoA1(c.hoja, c.fila, c.col, alto, ancho),
        values: c.valores.map(f => f.map(aCelda))
      });
      continue;
    }

  }

  await bajarGrupo();
  await bajarBorrados();
}

module.exports = { aplicar, rangoA1, aCelda, letraDeColumna, filasFueraDeLugar };
