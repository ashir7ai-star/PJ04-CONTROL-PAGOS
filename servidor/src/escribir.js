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
// y Sheets lo guarda como FECHA REAL gracias a USER_ENTERED.
//
// ⚠️ EL FORMATO IMPORTA, Y DEPENDE DEL IDIOMA DEL DOCUMENTO. Este documento
// está en **en_US**, donde "22/09/2026" no es una fecha válida (no hay mes 22):
// Sheets no la interpreta y la guarda como TEXTO, alineada a la izquierda, sin
// poder ordenarse ni filtrarse como fecha.
//
// No da ningún error. Desde la migración, TODAS las fechas se guardaron así
// —comprobado: las filas viejas son números de serie y las nuevas, texto—,
// justo el problema que ya había costado una jornada entera.
//
// El formato ISO (yyyy-MM-dd HH:mm:ss) lo entienden todos los idiomas.
// Verificado contra este documento: con dd/MM queda TEXTO, con ISO queda
// FECHA REAL.
//
// Sin zona a propósito: se manda la hora de pared y el documento la interpreta
// con SU zona horaria, que es como venía funcionando con Apps Script.
//
// Y una fecha SIN hora se manda sin hora. `FECHA DE PAGO` es un día, no un
// instante: la lógica la arma a las 00:00 y mandar "00:00:00" hacía que la
// hoja mostrara "22/09/2026 0:00:00", que no significa nada para quien lee.
function aCelda(v) {
  if (v instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    const dia = v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
    if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0) {
      return dia;
    }
    return dia + ' ' + p(v.getHours()) + ':' + p(v.getMinutes()) + ':' + p(v.getSeconds());
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
  // `values.update` lo devuelve arriba; `values.append`, dentro de `updates`.
  const real = filaDelRango(respuesta.updatedRange ||
                            (respuesta.updates && respuesta.updates.updatedRange));
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
  const metaDeHoja = async (nombre, refrescar) => {
    if (!metaHojas || refrescar) {
      cupo.anotar();
      const meta = await api.spreadsheets.get({
        spreadsheetId: id, fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
      });
      metaHojas = {};
      (meta.data.sheets || []).forEach(x => {
        const g = x.properties.gridProperties || {};
        metaHojas[x.properties.title] = { id: x.properties.sheetId, filas: g.rowCount || 0, columnas: g.columnCount || 0 };
      });
    }
    return Object.prototype.hasOwnProperty.call(metaHojas, nombre) ? metaHojas[nombre] : null;
  };
  const idDeHoja = async (nombre) => { const m = await metaDeHoja(nombre); return m ? m.id : null; };

  // ─── La cuadrícula se agranda sola, como en Apps Script ──────────────────
  //
  // `getRange(1, 27).setValue(...)` en Apps Script agranda la hoja si hace
  // falta. La API de Sheets NO: responde "Range (Viaticos!AA1) exceeds grid
  // limits" y no escribe nada. Así falló el registro de un pago el 21/09/2026:
  // la lógica quiso crear la columna ID REGISTRO en la 27 de una hoja de 26.
  //
  // No se comprueba antes de cada escritura —costaría una lectura de cuota
  // por petición— sino que se intenta, y SOLO si Sheets rechaza por tamaño se
  // agranda y se reintenta una vez. Se puede reintentar sin riesgo: ese
  // rechazo es de validación, ocurre antes de escribir nada.
  const ES_TAMANO = /exceeds grid limits/i;
  const agrandar = async (necesario) => {
    const requests = [];
    metaHojas = null;   // fresco: el tamaño pudo cambiar desde que se leyó
    for (const hoja of Object.keys(necesario)) {
      const m = await metaDeHoja(hoja);
      if (!m) continue;
      const n = necesario[hoja];
      if (n.filas > m.filas)       requests.push({ appendDimension: { sheetId: m.id, dimension: 'ROWS',    length: n.filas - m.filas } });
      if (n.columnas > m.columnas) requests.push({ appendDimension: { sheetId: m.id, dimension: 'COLUMNS', length: n.columnas - m.columnas } });
    }
    if (!requests.length) return false;
    cupo.anotarEscritura();
    await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: requests } });
    return true;
  };
  const conCuadriculaSuficiente = async (necesario, escribir) => {
    try {
      return await escribir();
    } catch (err) {
      if (!ES_TAMANO.test(String(err && err.message))) throw err;
      const crecio = await agrandar(necesario);
      if (!crecio) throw err;   // no era por tamaño nuestro: que se vea el error real
      return await escribir();
    }
  };
  // Acumula el rincón más lejano que toca cada hoja.
  const anotarNecesario = (necesario, hoja, fila, columna) => {
    const n = necesario[hoja] || (necesario[hoja] = { filas: 0, columnas: 0 });
    if (fila    > n.filas)    n.filas    = fila;
    if (columna > n.columnas) n.columnas = columna;
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
  let necesarioGrupo = {};
  const bajarGrupo = async () => {
    if (!grupo.length) return;
    const datos = grupo, necesario = necesarioGrupo;
    grupo = []; necesarioGrupo = {};
    await conCuadriculaSuficiente(necesario, async () => {
      cupo.anotarEscritura();
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId: id,
        requestBody: {
          // USER_ENTERED hace que Sheets interprete el valor como si alguien lo
          // hubiera tecleado: una fecha queda como FECHA REAL, no como texto.
          valueInputOption: 'USER_ENTERED',
          data: datos
        }
      });
    });
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

  // ─── Dónde cae una fila nueva: se decide acá, no en Sheets ───────────────
  //
  // El 19/09/2026 un pago de $100.000 quedó en la fila 1041 de una hoja con 44
  // filas de datos. No se perdió —la app lo leía— pero para quien mira la hoja
  // había desaparecido. En contabilidad eso es casi tan grave como perderlo.
  //
  // La causa: las hojas están convertidas en **Tablas de Sheets**.
  //
  //   · `appendRow()` de Apps Script agrega tras la última fila CON DATOS.
  //   · `values.append` agrega tras la TABLA.
  //
  // La migración cambió esa semántica sin que nadie tocara la lógica.
  //
  // ⚠️ El primer intento fue acotarle el rango de búsqueda a `values.append`
  // (`A1:L44`). NO SIRVE: la probamos agregando 1000 filas a mano y el pago
  // siguiente volvió a caer en la 1047. `values.append` resuelve la tabla a
  // partir del objeto Tabla de la hoja e **ignora el rango que se le pasa**.
  //
  // Por eso ya no se usa `append`. La fila la elige la lógica —que sabe dónde
  // terminan los datos porque acaba de leerlos— y acá se escribe ahí:
  //
  //   1. `insertDimension` abre la fila en esa posición exacta.
  //   2. `values.update` escribe adentro, con USER_ENTERED (las fechas siguen
  //      quedando como fechas reales, que costó una jornada conseguir).
  //
  // Insertar en vez de sobrescribir no es un detalle: si dos pagos llegan a la
  // vez y los dos calculan la misma fila, el segundo EMPUJA al primero en vez
  // de pisarlo. Ninguno se pierde.
  //
  // Y deja de importar cuántas filas de sobra tenga la hoja o hasta dónde
  // llegue la Tabla.
  let porAgregar = [];
  const bajarAgregados = async () => {
    if (!porAgregar.length) return;

    const lote = porAgregar;
    porAgregar = [];

    // Filas consecutivas de la misma hoja van en un solo par de llamadas.
    const bloques = [];
    for (const a of lote) {
      const u = bloques[bloques.length - 1];
      if (u && u.hoja === a.hoja && a.fila === u.fila + u.valores.length) u.valores.push(a.valores);
      else bloques.push({ hoja: a.hoja, fila: a.fila, valores: [a.valores] });
    }

    for (const b of bloques) {
      const hojaId = await idDeHoja(b.hoja);
      const alto   = b.valores.length;
      const ancho  = Math.max.apply(null, b.valores.map(v => v.length));

      // Sin `fila` no hay dónde insertar: no puede pasar (la registra el
      // adaptador), pero si pasara es mejor fallar que escribir a ciegas.
      if (!b.fila || hojaId === null) {
        throw new Error('No se pudo ubicar la fila nueva en "' + b.hoja + '". No se escribió nada.');
      }

      cupo.anotarEscritura();
      await api.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{ insertDimension: {
          range: { sheetId: hojaId, dimension: 'ROWS', startIndex: b.fila - 1, endIndex: b.fila - 1 + alto },
          // Hereda el formato de la fila de arriba, así la fila nueva se ve
          // igual que las demás. En la fila 1 no hay nada de donde heredar.
          inheritFromBefore: b.fila > 1
        } }] }
      });

      const necesario = {};
      anotarNecesario(necesario, b.hoja, b.fila + alto - 1, ancho);
      const r = await conCuadriculaSuficiente(necesario, async () => {
        cupo.anotarEscritura();
        return await api.spreadsheets.values.update({
          spreadsheetId: id,
          range: rangoA1(b.hoja, b.fila, 1, alto, ancho),
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: b.valores.map(f => f.map(aCelda)) }
        });
      });

      // Y se comprueba dónde cayó de verdad. Sin esto, que un dato quede en el
      // lugar equivocado NO da error: la app lo sigue leyendo y nadie se
      // entera hasta que alguien mira la hoja.
      verificarFila(b.hoja, b.fila, r && r.data);
    }
  };

  for (const c of cambios) {
    if (c.tipo === 'crearHoja' || c.tipo === 'formato' || c.tipo === 'congelar') continue;

    // Un borrado corta el grupo de escrituras (cambia el mapa de filas), pero
    // se acumula con los borrados que vengan pegados.
    if (c.tipo === 'borrar') {
      await bajarGrupo();
      await bajarAgregados();
      porBorrar.push({ hoja: c.hoja, desde: c.desde, cantidad: c.cantidad });
      continue;
    }

    // Cualquier otra cosa cierra el grupo de borrados pendiente.
    await bajarBorrados();

    if (c.tipo === 'agregar') {
      await bajarGrupo();
      porAgregar.push(c);
      continue;
    }

    await bajarAgregados();

    if (c.tipo === 'escribir') {
      const alto  = c.valores.length;
      const ancho = c.valores[0].length;
      anotarNecesario(necesarioGrupo, c.hoja, c.fila + alto - 1, c.col + ancho - 1);
      grupo.push({
        range: rangoA1(c.hoja, c.fila, c.col, alto, ancho),
        values: c.valores.map(f => f.map(aCelda))
      });
      continue;
    }

  }

  await bajarGrupo();
  await bajarAgregados();
  await bajarBorrados();
}

module.exports = { aplicar, rangoA1, aCelda, letraDeColumna, filasFueraDeLugar };
