// Busca identificadores USADOS pero nunca DECLARADOS en index.html.
// Uso: node prueba-referencias.js
//
// ─── Por qué existe ───────────────────────────────────────────────────────
//
// El 27/09, al reescribir el componente de subida, reemplacé el bloque entero
// desde su comentario de cabecera — y ahí adentro estaban `svgFile`, `svgImage`
// y `svgTrash`. Quedaron cuatro usos y ninguna declaración.
//
// `const` no se eleva: al pintar la lista de archivos saltaba
// "svgImage is not defined", el archivo elegido no aparecía y **nadie pudo
// registrar un pago durante un día entero**.
//
// Las 295 comprobaciones pasaban igual, porque el único control que había era
// `new Function(codigo)`: eso valida **sintaxis**, no que los identificadores
// existan. Un ReferenceError solo aparece al EJECUTAR esa línea — y esa línea
// solo se ejecuta cuando alguien adjunta un archivo.
//
// ─── Qué mira, y por qué solo eso ─────────────────────────────────────────
//
// Revisar todo el archivo sin un analizador de verdad da cientos de falsos
// positivos. Se mira donde el riesgo es real y el ruido, mínimo: los
// identificadores dentro de `${...}` en plantillas. Ahí es donde se arma el
// HTML, donde vivía este error, y donde un nombre inexistente no se nota hasta
// que un usuario toca el botón.

const fs = require('fs');
const path = require('path');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre +
              (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

// Se NORMALIZAN los saltos de linea al leer. El archivo usa CRLF, asi que
// cualquier split por salto de linea de mas abajo nunca coincidia: devolvia
// el archivo ENTERO en vez del trozo pedido, y las comprobaciones miraban
// mucho mas de lo que creian.
//
// Es el mismo defecto que ya se corrigio en prueba-logica-real.js el 15/10;
// este archivo habia quedado sin arreglar. Lo delato una mutacion que
// sobrevivia porque el patron buscado aparecia DOS veces en el archivo
// completo, y la prueba encontraba la otra.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
               .replace(/\r\n/g, '\n');
const bloques = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
const codigo = bloques.map(b => b[1]).join('\n');

// Nombres que el propio archivo declara.
const declarados = new Set();
const patrones = [
  /\bfunction\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
  /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
];
patrones.forEach(re => { let m; while ((m = re.exec(codigo))) declarados.add(m[1]); });

// Parámetros y desestructuraciones: sueltos, sin analizar de más.
const listas = [
  /\bfunction[^(]*\(([^)]*)\)/g,
  /\(([^()]{0,200}?)\)\s*=>/g,
  /\b(?:const|let|var)\s*\{([^}]*)\}/g,
  /\b(?:const|let|var)\s*\[([^\]]*)\]/g,
  /\.(?:map|forEach|filter|find|some|every|reduce|sort)\s*\(\s*\(([^)]*)\)/g,
  /\.(?:map|forEach|filter|find|some|every)\s*\(\s*([A-Za-z_$][\w$]*)\s*=>/g
];
listas.forEach(re => {
  let m;
  while ((m = re.exec(codigo))) {
    String(m[1]).split(/[,\s:=]+/).forEach(s => {
      const n = s.trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declarados.add(n);
    });
  }
});

const GLOBALES = new Set((
  'window document navigator location console JSON Math Date Object Array String Number Boolean ' +
  'RegExp Error TypeError Promise Set Map WeakMap Symbol parseInt parseFloat isNaN isFinite ' +
  'encodeURIComponent decodeURIComponent setTimeout clearTimeout setInterval clearInterval fetch ' +
  'FormData FileReader File Blob URL URLSearchParams AbortController alert confirm localStorage ' +
  'sessionStorage crypto Intl atob btoa requestAnimationFrame getComputedStyle CustomEvent Event ' +
  'this arguments undefined true false null typeof new delete void in of instanceof await async ' +
  'return if else for while do switch case break continue try catch finally throw class extends ' +
  'super yield let const var function flatpickr google gapi caches performance history screen ' +
  'globalThis structuredClone queueMicrotask Infinity NaN'
).split(/\s+/));

// Los ${...} de las plantillas.
const usados = new Map();
const placeholders = [...codigo.matchAll(/\$\{([^{}]*)\}/g)];
placeholders.forEach(p => {
  // Las cadenas de adentro no tienen identificadores: 'FECHA DE PAGO' no son
  // tres variables. Se vacían antes de mirar.
  const comillaSimple = new RegExp("'[^']*'", 'g');
  const comillaDoble  = new RegExp('"[^"]*"', 'g');
  const expr = String(p[1]).replace(comillaSimple, "''").replace(comillaDoble, '""');
  let m;
  const re = /(^|[^.\w$'"`])([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(expr))) {
    const n = m[2];
    if (declarados.has(n) || GLOBALES.has(n)) continue;
    // Claves de objeto dentro de la expresión: `{ a: 1 }`
    if (/^\s*:/.test(expr.slice(m.index + m[0].length))) continue;
    if (!usados.has(n)) usados.set(n, expr.trim().slice(0, 60));
  }
});

console.log('\n=== Identificadores usados en plantillas pero NO declarados ===');
console.log('  (declaraciones encontradas en index.html: ' + declarados.size + ')');
console.log('  (expresiones ${...} revisadas: ' + placeholders.length + ')');

const sueltos = [...usados.entries()];
sueltos.forEach(([n, ctx]) => console.log('  >>> ' + n + '   en: ' + ctx));

chk('ningún identificador de plantilla queda sin declarar',
    sueltos.length === 0, sueltos.map(s => s[0]));

console.log('\n=== Dinero Disponible: pestana propia, la primera ===');
{
  chk('existe la vista', /id="viewSaldos"/.test(html), 'falta la vista');
  chk('esta registrada en el navegador de pestanas',
      /saldos: viewSaldos/.test(codigo), 'la pestana no mostraria nada');

  // El orden importa: es lo que se pidio. Y la primera pestana es la que
  // arranca activa, asi que al abrir la app se sigue viendo la plata primero,
  // igual que cuando el bloque vivia arriba del formulario.
  const tabs = (html.match(/data-view="[a-z]+"/g) || []);
  chk('va primera en el menu', tabs[0] === 'data-view="saldos"', tabs.slice(0, 3));
  chk('y es la que arranca activa',
      /class="nav-tab active" data-view="saldos"/.test(html), 'arrancaria en otra pestana');
  chk('Nuevo Pago queda segunda', tabs[1] === 'data-view="form"', tabs.slice(0, 3));

  // El bloque se fue de Nuevo Pago: si quedara en los dos lados habria dos
  // elementos con el mismo id y uno de los dos no se actualizaria nunca.
  chk('la seccion de saldos existe UNA sola vez',
      (html.match(/id="seccionSaldos"/g) || []).length === 1,
      'dos ids iguales: uno quedaria muerto');

  // Sin esto se verian las dos vistas apiladas al abrir la app.
  const mainOculto = html.indexOf('<main style="display:none;">');
  const tituloForm = html.indexOf('id="formTitle"');
  chk('y el formulario de Nuevo Pago arranca oculto',
      mainOculto !== -1 && tituloForm > mainOculto && tituloForm - mainOculto < 220,
      'se verian dos vistas a la vez al abrir la app');

  // Lo que mas facil se rompe al mover un bloque: el refresco automatico
  // miraba el display de la PROPIA seccion. Ahora la seccion sigue visible y
  // el que se oculta es el <main> que la contiene, asi que hay que mirar al
  // padre o se pide cada 60 s estando parado en otra pestana.
  chk('el refresco mira si la pestana esta realmente a la vista',
      codigo.indexOf('s.offsetParent !== null') !== -1,
      'refrescaria cada 60 s desde otra pestana, gastando cuota de lectura');
  chk('al entrar se refresca solo si esta viejo',
      codigo.indexOf("dataset.view === 'saldos' && Date.now() - ultimoRefresco >= 15000") !== -1,
      'o no refresca nunca, o pide de nuevo en cada clic');

  // Sin cuentas asignadas: antes se ocultaba la seccion, que dentro de Nuevo
  // Pago estaba bien. Siendo una pestana entera, dejaria la pagina en blanco.
  chk('sin cuentas asignadas explica por que, no deja la pagina en blanco',
      /ninguna cuenta asignada/.test(codigo), 'quedaria una pestana vacia');
}

console.log('\n=== Tipos de pago: tres por fila, dos en celular ===');
{
  // El de escritorio se ve de una. El de CELULAR no: alguien puede unificar
  // la regla sin darse cuenta y dejar tres columnas en un telefono, donde
  // "Seguridad Social" y "Compra Materiales" se parten.
  const escritorio = html.split('.tipo-selector {')[1].split('}')[0];
  chk('en escritorio van tres por fila',
      /repeat\(3, 1fr\)/.test(escritorio), escritorio.replace(/\s+/g, ' ').slice(0, 90));

  const movil = html.split('@media (max-width: 640px)')[1] || '';
  const reglaMovil = movil.split('.tipo-selector {')[1] || '';
  chk('pero en celular se quedan en dos',
      /repeat\(2, 1fr\)/.test(reglaMovil.split('}')[0]),
      'tres columnas en un telefono parten las etiquetas largas');
}

console.log('\n=== Excel y PDF exportan las mismas columnas, con las dos fechas ===');
{
  // El bug que esto cierra (04/10): el PDF leia f['Fecha'], una clave que ya
  // no existia, y mostraba esa columna VACIA en todas las filas. Ademas no
  // llevaba ninguna de las dos fechas, y el Excel ponia el TOTAL debajo de
  // "Registrado por". Nada de eso daba error: eran indices escritos a mano
  // que quedaron corridos al agregar columnas.

  const listaCols = html.split('const COLUMNAS_EXPORT = [')[1].split('];')[0];
  const declaradas = (listaCols.match(/clave: '[^']+'/g) || [])
    .map(s => s.replace(/clave: '/, '').replace(/'$/, ''));

  const cuerpo = html.split('function filasParaExportar()')[1].split('\n    }')[0];
  const armadas = (cuerpo.match(/'[^']+':\s/g) || [])
    .map(s => s.replace(/':\s$/, '').replace(/^'/, ''));

  chk('la lista de columnas no esta vacia', declaradas.length > 0, declaradas);
  // ESTA es la comprobacion que faltaba: si una lista dice una cosa y la otra
  // dice otra, el reporte sale con una columna vacia y nadie se entera.
  chk('las columnas declaradas son EXACTAMENTE las que se arman',
      declaradas.join('|') === armadas.join('|'),
      { declaradas: declaradas, armadas: armadas });

  chk('el reporte lleva la fecha de registro',
      declaradas.indexOf('Registrado') !== -1, declaradas);
  chk('y la fecha de pago', declaradas.indexOf('Fecha de pago') !== -1, declaradas);

  // Ni el PDF ni el Excel pueden volver a tener la lista escrita a mano.
  const pdf = html.split('function exportarPdf()')[1].split('\n    }')[0];
  chk('el PDF arma sus columnas desde la lista',
      /head: \[COLUMNAS_EXPORT\.map/.test(html),
      'volvio a tener los encabezados escritos a mano');
  chk('y sus celdas tambien',
      /COLUMNAS_EXPORT\.map\(c => celdaPdf\(c, f\)\)/.test(html),
      'volveria a pedir claves que la tabla no tiene');
  // Se mira el CODIGO, no los comentarios: los comentarios que explican el
  // bug mencionan f['Fecha'] a proposito, y con un grep crudo esta prueba
  // fallaba por su propia documentacion. Ya hubo un caso al reves en este
  // repo —una prueba que pasaba porque hizo match con un comentario— asi que
  // vale la pena sacarlos antes de buscar.
  const sinComentarios = html.split('\n')
    .filter(l => l.trim().indexOf('//') !== 0)
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');
  chk('ya no busca la clave vieja "Fecha"',
      !/f\['Fecha'\]/.test(sinComentarios), 'esa clave no existe: la columna sale vacia');

  // El Excel: el total y el formato de numero tienen que seguir a la columna
  // de Valor, no a una letra fija.
  chk('el Excel ubica el TOTAL por posicion, no por letra fija',
      /i === COL_VALOR \? total/.test(html), 'el TOTAL caeria en otra columna');
  // Ojo con como se comprueba esto. Pedir que letra(COL_VALOR) aparezca "en
  // alguna parte" NO sirve: con dos usos, romper uno deja el otro y la prueba
  // pasa igual. Comprobado con una mutacion, que pasaba limpia. Se exige que
  // en el Excel no quede NINGUNA celda ubicada por letra escrita a mano.
  const excel = sinComentarios.split('function exportarExcel()')[1].split('\n    }')[0];
  chk('el Excel no ubica ninguna celda por letra fija',
      /letra\(COL_VALOR\)/.test(excel) && !/ws\['[A-Z]'/.test(excel),
      'una letra a mano se corre de columna al agregar una columna nueva');
  chk('los anchos salen de la misma lista',
      /COLUMNAS_EXPORT\.map\(c => \(\{ wch: c\.ancho \}\)\)/.test(html),
      'faltarian anchos al agregar una columna');
  chk('y los titulos de arriba se combinan hasta la ultima columna',
      /c: COLUMNAS_EXPORT\.length - 1/.test(html), 'el encabezado quedaria corto');
}

// El caso concreto que se escapó, por si alguien vuelve a mover el bloque.
console.log('\n=== Control de Viáticos: su propia pestaña, solo para administradores ===');
{
  // El panel dejó de vivir dentro de Nuevo Pago: tiene su vista, con el
  // resumen del día, una tarjeta por rubro y el detalle pago por pago.
  chk('existe la vista', /id="viewViaticos"/.test(html), 'falta la vista');
  chk('está registrada en el navegador de pestañas',
      /viaticos: viewViaticos/.test(codigo), 'la pestaña no mostraría nada');
  chk('y se carga al entrar, arrancando en Hoy',
      /tab\.dataset\.view === 'viaticos'\)\s*aplicarRango\('hoy'\)/.test(codigo), 'no se cargaría');

  // El campo de fecha TIENE que ser un calendario de verdad. La primera
  // versión dejó un <input> suelto sin inicializar: una caja de texto que no
  // hacía nada y que nadie entendía para qué estaba.
  chk('los campos de fecha son calendarios, no cajas de texto',
      /flatpickr\(vtDesdeInput/.test(codigo) && /flatpickr\(vtHastaInput/.test(codigo),
      'quedaría un input muerto');
  chk('hay atajos de rango (hoy, ayer, 7 días, mes)',
      /data-rango="hoy"/.test(html) && /data-rango="ayer"/.test(html) &&
      /data-rango="7"/.test(html) && /data-rango="mes"/.test(html), 'faltan atajos');
  chk('se puede buscar por texto', /vtDetalleFiltrado/.test(codigo), 'no hay búsqueda');
  chk('y filtrar por rubro', /rubro === '__sin'/.test(codigo), 'no hay filtro de rubro');
  chk('cada control lleva su etiqueta',
      /<label for="vtDesde">/.test(html) && /<label for="vtHasta">/.test(html) &&
      /<label for="vtBuscar">/.test(html) && /<label for="vtRubro">/.test(html),
      'un campo sin nombre no se entiende');

  // Desde el 2026-09-30 la pestaña es de quien tenga la sección Viáticos, no
  // solo de administradores. El servidor lo vuelve a comprobar en
  // puedeVerViaticos_, así que esto es la segunda barrera, no la única.
  chk('la pestaña se muestra a quien tenga la sección Viáticos',
      /navVt[\s\S]{0,120}?puede\('viaticos'\)/.test(codigo),
      'o volvió a ser solo de admins, o la verían todos');

  // Pero el tope diario lo define solo un administrador: un control que el
  // controlado puede subir deja de ser un control.
  chk('y el botón de presupuesto sigue siendo solo de administradores',
      /btnPresu[\s\S]{0,120}?esAdministrador/.test(codigo),
      'cualquiera podría subir el presupuesto que lo controla');

  // Orden del menú, tal como se pidió.
  const nav = html.split('<nav class="app-nav">')[1].split('</nav>')[0];
  const orden = [...nav.matchAll(/data-view="(\w+)"/g)].map(m => m[1]);
  chk('Control de Viáticos va después de Consultar Pagos',
      orden.indexOf('viaticos') === orden.indexOf('search') + 1, orden);
  chk('y Configuración queda al final',
      orden[orden.length - 1] === 'config', orden);

  // El panel ya no está en Nuevo Pago.
  chk('el panel salió de Nuevo Pago',
      !/<div class="presu" id="presupuesto"/.test(html), 'quedó duplicado');
  chk('y los saldos ya no lo cargan',
      !/pintarPresupuesto\(r\.presupuesto\)/.test(codigo), 'seguiría viajando con cada refresco');
}


console.log('\n=== El equipo se elige al registrar el viatico ===');
{
  // Cambio del 15/10 y en contra de como estaba: antes el equipo salia solo de
  // la persona. Los equipos ROTAN y el reparto lo mantiene un administrador,
  // asi que puede quedar viejo; quien esta registrando no.
  chk('hay un campo de equipo en el formulario',
      /id="campoEquipo"/.test(html) && /id="equipoViatico"/.test(html),
      'no habria donde elegirlo');
  chk('arranca oculto, como el rubro',
      /id="campoEquipo" style="display:none;"/.test(html),
      'se veria en secciones donde no significa nada');
  // 19/10: dejó de ser un desplegable obligatorio y pasó a ser informativo,
  // igual que "Registrado por". Lo decidió el usuario después del incidente
  // del 18/10, en el que un campo obligatorio que dependía de la red dejó a
  // todo el mundo sin poder registrar.
  chk('es un campo FIJO, no un desplegable',
      /<input type="text" id="equipoViatico" readonly/.test(html) &&
      !/<select id="equipoViatico"/.test(html),
      'volveria a poder elegirse, y a poder equivocarse');
  chk('y se ve como los demas campos bloqueados',
      /<div class="field campo-fijo" id="campoEquipo"/.test(html),
      'no se leeria como "esto sale de tu cuenta"');
  chk('ya no lleva asterisco de obligatorio',
      !/<label for="equipoViatico">Equipo <span class="req">/.test(html),
      'diria que hace falta llenarlo cuando no se llena');

  // Rubro y equipo se prenden y se apagan JUNTOS. Separarlos es como uno de los
  // dos se queda visible en una seccion donde no corresponde.
  chk('rubro y equipo se muestran con la misma funcion',
      /function actualizarCamposDeViatico\(\)/.test(codigo) &&
      !/function actualizarCampoRubro\(\)/.test(codigo),
      'quedarian dos interruptores para la misma cosa');
  chk('y el selector de tipo la llama',
      /actualizarCamposDeViatico\(\);/.test(codigo), 'el campo no aparecería nunca');

  // Lo que la funcion HACE, no que exista. Dejar el campo en 'none' fijo lo
  // esconderia para siempre —no habria donde elegir el equipo— y una
  // comprobacion de "la funcion esta" pasaria igual.
  const togg = codigo.split('function actualizarCamposDeViatico()')[1].split('\n    }')[0];
  chk('el campo de equipo se MUESTRA en viaticos, no solo se oculta',
      /campoEquipo\.style\.display = esViatico \? '' : 'none';/.test(togg) &&
      /campoRubro\.style\.display = esViatico \? '' : 'none';/.test(togg),
      'quedaria oculto siempre y no habria donde elegir el equipo');
  chk('y la lista se arma al mostrarlo',
      /if \(esViatico\) pintarEquiposDelPago\(\);/.test(togg),
      'apareceria vacio');

  // ⚠️ LO QUE EL 18/10 ROMPIO. El campo era obligatorio y su contenido venia
  // del servidor; con el servidor caido quedo vacio y NADIE PUDO REGISTRAR.
  // Un dato de configuracion no puede bloquear un pago.
  chk('el equipo NUNCA bloquea el registro',
      !/!selectEquipo\.value/.test(codigo),
      'volveria a dejar a todos sin poder registrar si no carga la lista');
  chk('y sin equipo asignado se avisa, pero se deja registrar',
      /Sin equipo asignado/.test(codigo) && /El pago se registra igual/.test(codigo),
      'quedaria sin explicar por que el campo esta raro');
  chk('el equipo NO viaja en el pago: lo pone el servidor',
      !/equipo:\s*selectEquipo\.value,/.test(codigo),
      'el navegador decidiria a que presupuesto se carga la plata');

  // Se MUESTRA el equipo de la cuenta: antes no se elegia y tampoco se veia.
  chk('muestra el equipo de la cuenta',
      /selectEquipo\.value = sesion\.equipoTexto;/.test(codigo),
      'no se veria a que presupuesto se le carga el gasto');

  // ⚠️ EL BUG DE FONDO DEL 18/10: guardarSesion escribia estos datos en el
  // navegador y NADA los volvia a leer. Se guardaban y no se usaban, asi que
  // bastaba con que el servidor no respondiera para quedarse sin equipo.
  chk('la sesion guardada se RESTAURA, no solo se guarda',
      /if \(datos\.equipoTexto\) sesion\.equipoTexto = datos\.equipoTexto;/.test(codigo) &&
      /if \(datos\.equipos && datos\.equipos\.length\) sesion\.equipos = datos\.equipos;/.test(codigo),
      'se guardaria en el navegador y nadie lo leeria, como el 18/10');
  chk('y se guarda la etiqueta, no solo la clave',
      /equipoTexto: sesion\.equipoTexto,/.test(codigo),
      'sin servidor se sabria equipo_2 pero no como se llama');
  // Una respuesta parcial no puede borrar lo que ya se sabia.
  chk('una respuesta sin equipos no borra la lista guardada',
      /datos\.equipos && datos\.equipos\.length/.test(codigo),
      'un arranque a medias dejaria el panel sin equipos');

  // La peor parte del 18/10 no fue el campo vacio: fue que la app se veia
  // normal y nadie supo que pasaba hasta un dia despues.
  // Mirar que el TEXTO exista no alcanza: envolverlo en `if (false)` lo deja
  // escrito y mudo. Hay que mirar que se LLAME, y guardado por la condicion
  // que corresponde. Sin saltos de linea en el patron: `[\s\S]{0,40}` salta
  // el que haya entre el `if` y la llamada.
  const falloArranque = codigo.split('No se pudo completar el arranque:')[1].slice(0, 1200);
  chk('si el arranque falla, se avisa en pantalla',
      /if \(sesion\.correo\) \{\s*showToast\('error', 'Sin conexión con el servidor'/
        .test(falloArranque),
      'la app volveria a verse normal con el servidor caido');
  chk('el arranque la trae',
      /if \(r\.equipos\)\s+sesion\.equipos\s+= r\.equipos;/.test(codigo) &&
      /if \(datos\.equipos\)\s+sesion\.equipos\s+= datos\.equipos;/.test(codigo),
      'el desplegable quedaria vacio por los dos caminos de arranque');
  chk('y el equipo de la persona tambien',
      /sesion\.equipo\s+= datos\.equipo\s+\|\| '';/.test(codigo),
      'no habria con que preseleccionar');

  // Es el unico dato del pago que la persona ELIGIO y que no se ve despues en
  // ningun lado: si se equivoco, la confirmacion es el momento de notarlo.
  chk('la confirmacion dice a que equipo quedo cargado',
      /esViatico && equipoTxt \? ' · ' \+ equipoTxt : ''/.test(codigo),
      'un equipo equivocado no se notaria hasta cuadrar los numeros');

  // Despues de registrar vuelve al equipo de la persona, no a vacio.
  const reset = codigo.split('function resetForm()')[1].split('\n    }')[0];
  chk('despues de enviar vuelve a quedar preseleccionado',
      /pintarEquiposDelPago\(\);/.test(reset),
      'el segundo pago del dia pediria elegir otra vez');
}

console.log('\n=== Quien esta en cada equipo: solo administradores ===');
{
  // Pedido textual del usuario (15/10): "solo los administradores pueden
  // modificar los equipos, nadie mas".
  chk('hay un bloque para administrar el reparto',
      /id="vtEquiposBloque"/.test(html) && /id="vtReparto"/.test(html),
      'no habria donde mover gente de equipo');

  // Agrupado POR EQUIPO, no una lista plana: dos columnas lado a lado dicen
  // quien esta donde sin leer fila por fila.
  chk('el reparto se agrupa por equipo, con "Sin equipo" al final',
      /\{ clave: '', etiqueta: 'Sin equipo' \}/.test(codigo) &&
      /class="vt-grupo"/.test(codigo),
      'volveria a ser una lista plana de nueve personas');
  chk('cada columna dice cuanta gente tiene',
      /class="vt-grupo-n"/.test(codigo), 'habria que contar a ojo');
  // Mover a alguien tiene que MOVERLO de columna, no solo cambiar su
  // desplegable: si no, el panel muestra dos cosas contradictorias.
  const guardar = codigo.split("action: 'asignar_equipo',")[1].split('} catch')[0];
  chk('al moverlo, se repinta con lo que devolvio el servidor',
      /if \(r\.personas\) pintarEquiposDePersonas\(r\.personas\);/.test(guardar),
      'la persona quedaria en la columna de antes');
  chk('arranca oculto y solo se muestra si llegan personas',
      /id="vtEquiposBloque" style="display:none;"/.test(html) &&
      /if \(!personas \|\| !personas\.length\) \{ bloque\.style\.display = 'none'; return; \}/.test(codigo),
      'un usuario comun veria la tabla vacia');
  chk('vive en Control de Viaticos, que es donde estan los presupuestos',
      html.split('<main id="viewViaticos"')[1].split('</main>')[0].indexOf('vtEquiposBloque') !== -1,
      'quedaria en otra pantalla');
  chk('cambiar el equipo llama al servidor',
      /action: 'asignar_equipo',/.test(codigo), 'el cambio no se guardaria');

  // Dejar en pantalla un valor que no se guardo es peor que no haber dejado
  // cambiarlo: el administrador se iria creyendo que si.
  chk('si la escritura falla, el selector vuelve a como estaba',
      (codigo.match(/sel\.value = antes;/g) || []).length === 2,
      'mostraria un equipo que no quedo guardado');
  chk('y si sale bien, muestra lo que el servidor dice que guardo',
      /sel\.value = r\.equipo \|\| '';/.test(codigo),
      'mostraria lo elegido, no lo guardado');

  // La primera carga arranca en el equipo de la persona, pero una vez que
  // elige no se le vuelve a cambiar: "Todos los equipos" es una eleccion.
  chk('la primera carga arranca en el equipo de la persona',
      /if \(!vtEquipoElegido && sesion\.equipo\)/.test(codigo),
      'arrancaria en Todos y habria que elegir siempre');
  chk('y elegir a mano apaga la preseleccion',
      /vtEquipoElegido = true;\s*\n\s*cargarControlViaticos\(\);/.test(codigo),
      'la pantalla le pisaria la eleccion en cada recarga');
}

console.log('\n=== "Registrado por" nunca queda en blanco ===');
{
  // Reportado el 19/10: "han habido ocasiones que no aparece el nombre".
  //
  // La causa: el nombre se escribia SOLO dentro de aplicarPermisos(), que
  // corre al entrar y al refrescar la sesion — pero no despues de registrar
  // un pago. Y resetForm() hace form.reset(), que devuelve cada campo a su
  // defaultValue: como este input no trae `value` en el HTML, quedaba VACIO.
  // Desaparecia a partir del segundo pago de cada sesion.
  chk('pintar el nombre es una funcion propia, no codigo suelto',
      /function pintarQuienRegistra\(\)/.test(codigo),
      'volveria a estar metido en un solo lugar, y a perderse en el otro');

  const reset = codigo.split('function resetForm()')[1].split('\n    }')[0];
  chk('se repinta al vaciar el formulario',
      /pintarQuienRegistra\(\);/.test(reset),
      'el segundo pago de cada sesion saldria sin nombre');
  // El orden importa: repintar ANTES del reset no sirve de nada.
  chk('y DESPUES de form.reset(), no antes',
      reset.indexOf('form.reset()') < reset.indexOf('pintarQuienRegistra()'),
      'el reset lo borraria justo despues de pintarlo');

  // El arreglo de raiz: el valor por omision de un input es su defaultValue.
  // Con esto, cualquier reset futuro lo restaura en vez de borrarlo.
  const pinta = codigo.split('function pintarQuienRegistra()')[1].split('\n    }')[0];
  chk('el valor queda como defaultValue, para que reset lo RESTAURE',
      /campo\.defaultValue = quienSoy;/.test(pinta),
      'habria que acordarse de repintar en cada lugar que resetee');

  // Un pago sin saber quien lo cargo es lo unico que esta columna no puede
  // permitir: es toda la trazabilidad que tiene la contabilidad.
  chk('sin nombre en la cuenta se cae al correo, nunca a vacio',
      /sesion\.nombre \|\| sesion\.correo \|\| ''/.test(pinta),
      'quedaria en blanco para quien no tenga nombre cargado');

  chk('y aplicarPermisos sigue llamandola',
      /pintarQuienRegistra\(\);/.test(codigo.split('function aplicarPermisos()')[1].split('\n    }')[0]),
      'no se pintaria al entrar');
}

console.log('\n=== El panel compara los equipos, no los muestra de a uno ===');
{
  // Con dos presupuestos distintos, la primera pregunta es "como va cada uno".
  // Un desplegable obliga a mirar uno, recordar la cifra, cambiar y comparar
  // de memoria. Las tarjetas lo responden de un vistazo.
  chk('hay tarjetas de equipo, una al lado de la otra',
      /id="vtEquiposCards"/.test(html) && /class="vt-equipos"/.test(html),
      'habria que elegir un equipo por vez para compararlos');
  chk('"Todos los equipos" va primero',
      /clave: '', etiqueta: 'Todos los equipos',/.test(codigo),
      'no habria forma de ver el total de la empresa');
  chk('cada tarjeta trae su barra contra el presupuesto',
      /class="vt-eq-barra"/.test(codigo) && /Math\.min\(100, pct\)/.test(codigo),
      'una barra de mas de 100% se saldria de la tarjeta');
  chk('y avisa cuando no hay tope, en vez de mostrar 0%',
      /\(!hay \? 'sin tope'/.test(codigo),
      'un equipo sin presupuesto se veria como uno que no gasto');

  // Las tarjetas son el selector. Pero el <select> oculto sigue siendo la
  // fuente de verdad: dos controles para el mismo dato se desincronizan.
  chk('las tarjetas son botones que filtran',
      /data-equipo="/.test(codigo) && /sel\.dispatchEvent\(new Event\('change'\)\)/.test(codigo),
      'serian decorativas');
  chk('el select sigue siendo la unica fuente de verdad',
      /<select id="vtEquipo" hidden>/.test(html),
      'habria dos controles para el mismo dato');

  // Un total de equipo que cambia al escribir en el buscador no se puede
  // comparar contra su presupuesto, que es para lo que esta.
  chk('las tarjetas NO se achican con los filtros de texto',
      codigo.indexOf('pintarTarjetasDeEquipo(p);') !== -1 &&
      !/pintarTarjetasDeEquipo\(det/.test(codigo),
      'el total del equipo cambiaria al buscar');
  // Y entonces el total de lo filtrado tiene que decirse en la tabla.
  chk('pero el total de lo filtrado se dice en el detalle',
      /formatoPesos\(det\.reduce/.test(codigo), 'la cifra filtrada se perderia');

  // Las acciones no son filtros: mezclarlas hace dudar de las dos cosas.
  const filtros = html.split('<section class="vt-filtros">')[1].split('</section>')[0];
  chk('los botones salieron de la caja de filtros',
      filtros.indexOf('vtEditarPresupuesto') === -1 &&
      html.split('<div class="vt-acciones">')[1].indexOf('vtEditarPresupuesto') !== -1,
      'un boton que hace algo no es un filtro');
}

console.log('\n=== Filtrar por VARIOS tipos de pago a la vez ===');
{
  // Antes era un <select> de una sola opcion: pedir "proveedores Y traslados"
  // era imposible. Ahora son casillas.
  chk('el filtro de tipo son casillas, no un desplegable',
      /id="fTipos"/.test(html) && !/<select id="fTipo">/.test(html),
      'seguiria dejando elegir un solo tipo');

  const caja = html.split('id="fTipos"')[1].split('</div>')[0];
  const valores = [...caja.matchAll(/value="([^"]+)"/g)].map(m => m[1]);
  const botones = [...new Set([...html.matchAll(/class="tipo-btn" data-value="([^"]+)"/g)]
                              .map(m => m[1]))];
  const faltan = botones.filter(t => valores.indexOf(t) === -1);
  chk('todo tipo que se puede registrar se puede filtrar', faltan.length === 0, faltan);
  const sobran = valores.filter(t => botones.indexOf(t) === -1 && t !== 'traslado');
  chk('y el filtro no ofrece tipos que no existen', sobran.length === 0, sobran);

  // Nuevo Pago y Solicitudes tienen cada una SU listado de botones. Un tipo
  // que se pueda registrar pero no solicitar (o al reves) es una diferencia
  // que nadie nota hasta que alguien la necesita.
  const sacaTipos = t => [...t.matchAll(/class="tipo-btn" data-value="([^"]+)"/g)].map(m => m[1]);
  const listaPago = sacaTipos(html.split('id="tipoFactura"')[0]);
  const listaSol  = sacaTipos(html.split('id="tipoFactura"')[1].split('id="tipoFacturaSolicitud"')[0]);
  chk('los dos listados de tipos ofrecen lo mismo',
      listaPago.length > 0 && listaPago.join(',') === listaSol.join(','),
      { pago: listaPago, solicitud: listaSol });
  chk('incluido Traslado entre cuentas', valores.indexOf('traslado') !== -1, valores);
  chk('y se dice que sin marcar nada salen todos',
      /Sin marcar nada se muestran todos/.test(html),
      'nadie sabria que significa no marcar nada');

  // Un filtro activo que no se ve es un filtro que confunde.
  chk('una casilla marcada se distingue a simple vista',
      /\.tipo-casilla:has\(input:checked\)/.test(html),
      'se buscaria con un tipo puesto sin notarlo');

  // ─── claveDeTipo, ejecutada de verdad ───
  //
  // El filtro comparaba con `rTipo.includes(tipo)` y eso tenia un error que no
  // se veia: 'compra_materiales' CONTIENE 'compra'. Filtrar por Compra traia
  // 43 pagos en vez de 21 (verificado contra la hoja real el 22/10).
  const fuente = codigo.split('function claveDeTipo(')[1];
  const cuerpo = 'function claveDeTipo(' + fuente.split('\n    }')[0] + '\n}';
  let claveDeTipo;
  try { claveDeTipo = eval('(' + cuerpo + ')'); } catch (e) { claveDeTipo = null; }
  chk('claveDeTipo se puede ejecutar', typeof claveDeTipo === 'function', cuerpo.slice(0, 80));

  if (claveDeTipo) {
    chk('Compra y Compra Materiales son tipos DISTINTOS',
        claveDeTipo('compra') === 'compra' &&
        claveDeTipo('compra_materiales') === 'compra_materiales',
        [claveDeTipo('compra'), claveDeTipo('compra_materiales')]);

    // Los 8 tipos que existen de verdad en la hoja. Si alguno diera '', esas
    // filas quedarian fuera de TODO filtro.
    const reales = ['caja_menor', 'compra', 'compra_materiales', 'impuestos',
                    'nomina', 'pago_proveedor', 'seguridad_social', 'viaticos'];
    const perdidos = reales.filter(t => claveDeTipo(t) !== t);
    chk('los 8 tipos reales de la hoja se reconocen', perdidos.length === 0, perdidos);

    // Se escribieron de varias formas a lo largo del tiempo: recortar aca
    // seria perder pagos viejos.
    chk('las variantes viejas siguen cayendo donde corresponde',
        claveDeTipo('viatico') === 'viaticos' &&
        claveDeTipo('Caja Menor') === 'caja_menor' &&
        claveDeTipo('nómina') === 'nomina' &&
        claveDeTipo('Compra Materiales') === 'compra_materiales',
        [claveDeTipo('viatico'), claveDeTipo('Caja Menor'),
         claveDeTipo('nómina'), claveDeTipo('Compra Materiales')]);

    // NO adivina: un pago mal etiquetado queda fuera, no se cuela en otro.
    chk('un tipo desconocido no se cuela en ningun filtro',
        claveDeTipo('cualquier_cosa') === '' && claveDeTipo('') === '',
        [claveDeTipo('cualquier_cosa')]);
  }

  // Vacio = todos. Y la comparacion es por clave canonica, no por "contiene".
  chk('sin marcar nada no se filtra por tipo',
      /if \(tipos\.length && tipos\.indexOf\(claveDeTipo\(rTipo\)\) === -1\) return false;/.test(codigo),
      'o filtraria de mas, o volveria al "contiene"');

  // Una casilla oculta por permisos tiene que DESMARCARSE: si no, filtra por
  // algo que la persona no ve y los resultados salen recortados sin motivo.
  chk('una casilla que se oculta se desmarca',
      /et\.hidden = !permitido;\s*\n\s*if \(!permitido\) c\.checked = false;/.test(codigo),
      'quedaria filtrando por un tipo invisible');
  chk('los traslados siguen siendo solo para administradores',
      /c\.value === 'traslado'\s*\n\s*\? sesion\.rol === 'admin'/.test(codigo),
      'un usuario comun veria movimientos entre cuentas');

  // El Excel y el PDF tienen que decir TODOS los tipos pedidos.
  chk('el archivo exportado lista todos los tipos elegidos',
      /tipos\.map\(function \(t\) \{[\s\S]{0,60}tipoInfo\(t\)\.label/.test(codigo),
      'quien reciba el archivo no podria reproducir la consulta');

  chk('Limpiar desmarca todas las casillas',
      /#fTipos input'\)\.forEach\(function \(c\) \{ c\.checked = false; \}\)/.test(codigo),
      'quedarian tipos marcados despues de limpiar');
  chk('marcar una casilla refiltra sin volver al servidor',
      /getElementById\('fTipos'\)\.addEventListener\('change'/.test(codigo),
      'habria que apretar Buscar de nuevo, y eso es una consulta completa');
}

console.log('\n=== Las columnas que se exportan EXISTEN en las filas ===');
{
  // `clave` en COLUMNAS_EXPORT hace dos trabajos: es el titulo de la columna
  // y es la llave con la que se busca el dato en cada fila. Si cambia uno y
  // no el otro, la columna sale VACIA en todas las filas y nada falla.
  //
  // Ya paso: el PDF leia f['Fecha'], una clave que no existia, y la columna
  // de fecha salio en blanco en todos los reportes hasta que alguien lo miro.
  const claves = [...codigo.split('const COLUMNAS_EXPORT = [')[1].split('];')[0]
                    .matchAll(/clave:\s*'([^']+)'/g)].map(m => m[1]);
  const fila = codigo.split('function filasParaExportar()')[1].split('}));')[0];
  const enLaFila = [...fila.matchAll(/'([^']+)':/g)].map(m => m[1]);
  const faltan = claves.filter(c => enLaFila.indexOf(c) === -1);
  chk('cada columna exportada tiene su dato (' + claves.length + ' columnas)',
      claves.length > 0 && faltan.length === 0, faltan);

  // Y al reves: un dato que se arma y no se exporta es trabajo tirado.
  const sobran = enLaFila.filter(c => claves.indexOf(c) === -1);
  chk('y no se arma ningun dato que despues no se use', sobran.length === 0, sobran);

  // El mismo dato tenia dos nombres segun la pantalla.
  chk('Consultar Pagos y Control de Viaticos lo llaman igual',
      /<th>Concepto<\/th>/.test(html) &&
      /<th>Concepto<\/th>/.test(codigo.split("'<thead><tr><th>Fecha del gasto</th>")[1] || '<th>Concepto</th>'),
      'el mismo dato con dos nombres confunde al compararlos');
  chk('y ya no queda el nombre viejo en la tabla',
      !/<th>Nombre del pago<\/th>/.test(html),
      'quedarian las dos');
}

console.log('\n=== El detalle de viaticos se puede bajar en PDF ===');
{
  chk('hay boton de PDF en la tarjeta de Detalle',
      /id="btnVtPdf"/.test(html), 'no habria como descargarlo');
  chk('y esta DENTRO de esa tarjeta, no en otra',
      html.split('Detalle de pagos')[1].split('</section>')[0].indexOf('btnVtPdf') !== -1,
      'quedaria en un bloque que no le corresponde');
  chk('el boton hace algo', /btnVtPdf'\)\.addEventListener\('click', descargarViaticosPdf\)/.test(codigo),
      'seria decorativo');

  const pdf = codigo.split('function descargarViaticosPdf()')[1].split('\n    }\n')[0];

  // Un PDF que traiga MAS filas que la pantalla no se puede verificar contra
  // ella, y el reporte se usa justamente para eso.
  chk('baja lo que se esta VIENDO, con los filtros puestos',
      /const det = vtDetalleFiltrado\(\);/.test(pdf),
      'traeria filas que no estan en pantalla');
  chk('y el total es el de lo filtrado, no el del periodo',
      /const total\s+= det\.reduce/.test(pdf),
      'la suma no cuadraria con las filas de la tabla');
  chk('si hay filtro puesto, el PDF lo dice',
      /FILTRADO \(/.test(pdf), 'pareceria el reporte completo del periodo');

  // Sin filas no se genera un PDF vacio: se explica.
  chk('sin pagos avisa en vez de bajar un PDF en blanco',
      /if \(!det\.length\) \{[\s\S]{0,120}showToast/.test(pdf),
      'bajaria un documento vacio que parece un error');

  // Con un equipo elegido ya lo dice el encabezado; repetirlo por fila es ruido.
  chk('la columna de equipo sale solo cuando se ven todos',
      /const porEquipo = !p\.equipo;/.test(pdf),
      'o faltaria el equipo, o se repetiria en cada fila');

  // Si se cargo otro dia hay que decirlo, igual que en la pantalla.
  chk('avisa cuando el gasto se cargo otro dia',
      /cargado el ' \+ d\.registrado/.test(pdf),
      'nadie entenderia por que un gasto de ayer sale hoy');

  // La lista de rubros vive en el servidor. Una copia aca se desalinea.
  chk('las etiquetas de rubro salen del servidor, no de una copia',
      /vtDatos && vtDatos\.rubros/.test(codigo.split('function etiquetaDeRubroVt')[1].split('\n    }')[0]),
      'habria dos listas de rubros que se separan con el tiempo');

  // Tres documentos de la misma empresa que se ven distinto parecen de
  // sistemas distintos.
  chk('usa el mismo azul y el mismo encabezado que el otro PDF',
      /const azul = \[0, 113, 227\]/.test(pdf) && /Millennium Energy Co/.test(pdf),
      'se veria como de otro sistema');
  chk('y numera las paginas', /Página ' \+ i \+ ' de ' \+ paginas/.test(pdf),
      'un reporte de varias hojas sin numerar se desordena al imprimir');
}

console.log('\n=== Las variables de CSS que se usan EXISTEN ===');
{
  // El 15/10 esta hoja usaba --surface-1, --border-subtle y --text-1, que NO
  // estaban declaradas. Una declaracion con una variable inexistente es
  // invalida y el navegador la descarta ENTERA: las tarjetas quedaron sin
  // fondo y los bordes no se dibujaron. No fallaba nada y ninguna prueba lo
  // veia — solo se veia mal, y asi estuvo hasta que el usuario miro la
  // pantalla y dijo que parecia desordenada.
  //
  // `var(--x, algo)` con respaldo es legitimo aunque --x no exista, asi que
  // solo se miran los usos SIN respaldo.
  const estilos = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const declaradas = new Set([...estilos.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(m => m[1]));
  const usadas = [...estilos.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map(m => m[1]);
  const huerfanas = [...new Set(usadas)].filter(v => !declaradas.has(v));
  chk('ninguna variable se usa sin declarar (' + declaradas.size + ' declaradas)',
      huerfanas.length === 0, huerfanas);
}

console.log('\n=== Los iconos de la lista de archivos existen ===');
['svgFile', 'svgImage', 'svgTrash'].forEach(n => {
  const usos = (codigo.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
  const decl = new RegExp('(?:const|let|var)\\s+' + n + '\\b').test(codigo);
  chk(n + ' está declarado (' + usos + ' usos)', decl, 'usado pero nunca declarado');
});

console.log('\n=== El panel de mensajes esta cableado de punta a punta ===');
{
  // Una pestaña sin vista, o una vista sin entrada en `vistasPorNombre`, no da
  // error: simplemente no pasa nada al tocar el botón. Es el tipo de falla que
  // solo se descubre usándola.
  chk('existe la pestaña', /data-view="mensajes"/.test(html));
  chk('existe la vista', /<main id="viewMensajes"/.test(html));
  chk('y la vista esta registrada en el conmutador',
      /vistasPorNombre\s*=\s*\{[\s\S]*?mensajes:\s*viewMensajes/.test(codigo));
  chk('al entrar se carga el panel',
      /dataset\.view === 'mensajes'\)\s*abrirMensajes\(\)/.test(codigo));
  chk('y al salir se corta el sondeo',
      /dataset\.view !== 'mensajes'\)\s*detenerSondeoMensajes\(\)/.test(codigo));
}

console.log('\n=== Los elementos que el chat busca EXISTEN en el HTML ===');
{
  // Mismo riesgo que con los iconos svg: `getElementById` de algo que no está
  // devuelve null, y el error salta recién cuando alguien toca el panel.
  const bloque = codigo.slice(codigo.indexOf('const msgWrap'),
                              codigo.indexOf('// ─── Service Worker + banner'));
  chk('el bloque del chat se encontro', bloque.length > 500, bloque.length);

  const pedidos = [...bloque.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const faltan  = pedidos.filter(id => html.indexOf('id="' + id + '"') === -1);
  chk(pedidos.length + ' identificadores pedidos, todos declarados',
      faltan.length === 0, faltan);
}

console.log('\n=== El texto de un mensaje NO se inserta como HTML ===');
{
  // Lo escribió otra persona. Con innerHTML, un mensaje con `<img onerror=…>`
  // se ejecutaría en la pantalla de quien lo recibe.
  const burbuja = codigo.slice(codigo.indexOf('function burbujaDe'),
                               codigo.indexOf('function pintarMensajes'));
  chk('la burbuja se arma con textContent', /cuerpo\.textContent\s*=\s*m\.texto/.test(burbuja));
  chk('y nunca con innerHTML', !/innerHTML/.test(burbuja), 'innerHTML dentro de burbujaDe');

  const lista = codigo.slice(codigo.indexOf('function pintarLista'),
                             codigo.indexOf('function actualizarGlobo'));
  chk('el nombre y el ultimo mensaje tambien van como texto',
      /nom\.textContent/.test(lista) && /ult\.textContent/.test(lista));
}

console.log('\n=== Las notificaciones: permiso, suscripcion y el caso iPhone ===');
{
  chk('el permiso se pide desde un clic, no al cargar',
      /msgActivar\.addEventListener\('click'[\s\S]{0,400}?Notification\.requestPermission\(\)/.test(codigo));
  chk('y despues se registra la suscripcion',
      /requestPermission\(\)[\s\S]{0,600}?await suscribirAAvisos\(\)/.test(codigo));
  chk('se avisa que en iPhone hay que instalar la app',
      /esIOS\(\)\s*&&\s*!estaInstalada\(\)/.test(codigo) &&
      /Agregar a inicio/.test(codigo));
  chk('y ahi NO se ofrece un boton que no haria nada',
      /esIOS\(\) && !estaInstalada\(\)\)[\s\S]{0,400}?msgActivar\.style\.display = 'none'/.test(codigo));

  const clave = (codigo.match(/const VAPID_PUBLICA = '([^']*)'/) || [])[1] || '';
  chk('la clave publica esta puesta de verdad',
      clave.length === 87 && /^B[A-Za-z0-9_-]+$/.test(clave), clave.slice(0, 12) + '… (' + clave.length + ')');
}

console.log('\n=== El Service Worker sabe recibir y abrir la notificacion ===');
{
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
  chk('escucha push', /addEventListener\('push'/.test(sw));
  chk('muestra la notificacion', /showNotification\(/.test(sw));
  chk('aun si el push viene sin datos legibles',
      /catch \(err\) \{ d = \{\}; \}/.test(sw) && /d\.cuerpo \|\|/.test(sw));
  chk('escucha el toque', /addEventListener\('notificationclick'/.test(sw));
  chk('y reusa la ventana abierta en vez de abrir otra',
      /matchAll\(\{ type: 'window'[\s\S]{0,400}?c\.focus\(\)/.test(sw));
  chk('avisa a la app cual conversacion abrir',
      /postMessage\(\{ tipo: 'abrir-chat'/.test(sw));
  chk('y si el navegador renueva la suscripcion, pide volver a registrarla',
      /addEventListener\('pushsubscriptionchange'/.test(sw) && /'resuscribir'/.test(sw));
  chk('la app atiende ese aviso',
      /tipo === 'resuscribir'\) \{ suscribirAAvisos\(\)/.test(codigo));
}

console.log('\n=== Se puede COMPROBAR que el aviso suena, sin otro telefono ===');
//
// El dia que las notificaciones no llegaron, nada en la pantalla lo decia:
// el aviso amarillo se escondia al conceder el permiso y a partir de ahi la
// app no volvia a hablar del tema. Estas comprobaciones existen para que esa
// pantalla muda no vuelva.
{
  chk('con el permiso ya dado, la franja informa en vez de esconderse',
      /Notification\.permission === 'granted'\)\s*\{[\s\S]{0,300}?msgAviso\.style\.display = ''/.test(codigo));
  chk('y ofrece el boton de probar',
      /Notification\.permission === 'granted'\)\s*\{[\s\S]{0,400}?msgProbar\.style\.display = ''/.test(codigo));
  chk('el boton existe en el HTML', /id="msgProbar"/.test(html));
  chk('arranca escondido, para no ofrecerlo antes de tener permiso',
      /id="msgProbar"[^>]*style="display:none;"/.test(html));
  chk('y se esconde de nuevo si el permiso no esta',
      /msgProbar\.style\.display = 'none'/.test(codigo));

  const probar = (codigo.match(/msgProbar\.addEventListener\('click'[\s\S]{0,2600}?\n    \}\);/) || [])[0] || '';
  chk('la prueba le pide al servidor que mande el aviso de verdad',
      /action: 'probar_aviso'/.test(probar));
  chk('y antes vuelve a registrar el dispositivo',
      /await suscribirAAvisos\(\)[\s\S]{0,300}?probar_aviso/.test(probar));
  chk('distingue el servidor sin claves VAPID', /SIN_VAPID/.test(probar));
  chk('distingue el dispositivo sin registrar', /SIN_SUSCRIPCIONES/.test(probar));
  chk('y muestra el codigo cuando el servicio de push rechaza el envio',
      /f\.codigo/.test(probar) && /f\.mensaje/.test(probar));
  chk('el boton no se queda deshabilitado si algo falla',
      /finally \{[\s\S]{0,200}?msgProbar\.disabled = false/.test(probar));
}

// El Service Worker se vuelve a leer: el bloque de arriba lo declaro dentro
// de su propio alcance, y repetir la lectura cuesta menos que mover eso.
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8').replace(/\r\n/g, '\n');

console.log('\n=== Tocar la notificacion abre el CHAT, no la pantalla de inicio ===');
//
// Con la app cerrada, el Service Worker no tiene ventana a la que avisarle:
// abria la app y caia en la vista por defecto. El destino tiene que viajar en
// la URL o la notificacion no sirve de nada.
{
  chk('con la app cerrada, el link lleva al chat',
      sw.indexOf("'?chat=1' +") !== -1);
  chk('y dice cual conversacion',
      sw.indexOf("'&hilo=' + encodeURIComponent(hilo)") !== -1);
  chk('el openWindow usa ese destino, no el scope pelado',
      sw.indexOf('openWindow(destino)') !== -1 &&
      sw.indexOf('openWindow(self.registration.scope)') === -1);
  chk('la app atiende ese link, y no hay ninguna salida antes de leerlo',
      /function abrirChatSiLoPideElLink\(\) \{\s*if \(yaAbriChatPorLink\) return;\s*const q = new URLSearchParams\(location\.search\);\s*if \(q\.get\('chat'\) !== '1'\) return;/.test(codigo));
  chk('y limpia la URL, para que recargar no vuelva a entrar al chat',
      /history\.replaceState/.test(codigo));
  chk('se abre por un solo camino, compartido con el toque de la notificacion',
      /function irAMensajes\(/.test(codigo) &&
      /tipo !== 'abrir-chat'\) return;\n        irAMensajes\(/.test(codigo) &&
      /yaAbriChatPorLink = true;[\s\S]{0,400}?irAMensajes\(hilo\)/.test(codigo));
  chk('y se dispara una sola vez', /if \(yaAbriChatPorLink\) return;/.test(codigo));
}

console.log('\n=== El numero en la pestana aparece SIN estar en el panel ===');
//
// El sondeo del panel se corta al salir de Mensajes, a proposito. Sin nada que
// pregunte desde las otras pantallas, un empleado contestaba y el
// administrador no se enteraba: ni aviso ni numero.
{
  chk('hay un sondeo del contador aparte del panel',
      /function arrancarSondeoGlobo\(\)/.test(codigo) &&
      /sondeoGlobo = setInterval/.test(codigo));
  chk('pide solo el conteo, no la conversacion',
      codigo.indexOf("action: 'contar_sin_leer'") !== -1);
  chk('arranca recien con la sesion puesta, que es cuando se sabe el rol',
      /pintarEquiposDelPago\(\);[\s\S]{0,400}?arrancarSondeoGlobo\(\)/.test(codigo));
  chk('no se pisa con el sondeo del panel, que trae datos mas frescos',
      /async function contarSinLeer\(\)[\s\S]{0,240}?if \(chat\.sondeo\) return;/.test(codigo));
  chk('no pregunta con la app en segundo plano',
      /sondeoGlobo = setInterval[\s\S]{0,120}?if \(document\.hidden\) return;/.test(codigo));
  chk('pero pregunta en el acto al volver a la app',
      /visibilitychange'[\s\S]{0,200}?if \(!document\.hidden\) contarSinLeer\(\)/.test(codigo));
  chk('pintar el globo esta separado de calcularlo',
      /function ponerGlobo\(total\)/.test(codigo) &&
      /function actualizarGlobo\([\s\S]{0,360}?ponerGlobo\(total\)/.test(codigo));

  chk('al recibir un push, el Service Worker avisa a la app abierta',
      sw.indexOf("postMessage({ tipo: 'mensaje-nuevo'") !== -1);
  chk('y lo hace DESPUES de mostrar la notificacion, que es obligatoria',
      /await self\.registration\.showNotification\([\s\S]{0,900}?tipo: 'mensaje-nuevo'/.test(sw));
  chk('la app lo atiende y refresca el numero',
      /tipo === 'mensaje-nuevo'\)[\s\S]{0,260}?contarSinLeer\(\)/.test(codigo));
  chk('o la conversacion, si la esta mirando',
      /tipo === 'mensaje-nuevo'\)[\s\S]{0,200}?if \(chat\.sondeo\) cargarMensajes\(false\)/.test(codigo));
}

console.log('\n=== Un fondo sin presupuesto: la tarjeta muestra el GASTO, no un saldo ===');
//
// El usuario decidio (2026-10-27) que Gastos de Viaje no lleve tope. Sin esto,
// la tarjeta decia "Sin configurar" con un aviso arriba que no se apagaba
// nunca, y escondia el unico dato util: cuantas facturas y por cuanto.
{
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script.gs'), 'utf8').replace(/\r\n/g, '\n');

  // Coherencia entre los dos lados. El nombre del campo es un contrato: si
  // alguien lo renombra en un archivo y no en el otro, no falla nada —la
  // tarjeta simplemente vuelve a decir "Sin configurar" y nadie entiende por
  // que. Es el mismo criterio de la comprobacion de ACCIONES.
  chk('el servidor manda el campo y la pantalla lo lee con el mismo nombre',
      /sinPresupuesto:\s*!!cfg\.sinPresupuesto/.test(gs) &&
      codigo.indexOf('c.sinPresupuesto') !== -1);
  chk('y la cuenta de viajes esta marcada en el servidor',
      /gastos_viaje:[^\n]*sinPresupuesto:\s*true/.test(gs));

  // La cifra grande. Si mostrara `c.saldo`, un fondo sin base da 0: la tarjeta
  // diria "$0" con las facturas ya cargadas en la hoja.
  chk('la cifra grande es lo GASTADO, no el saldo',
      /saldo-monto[\s\S]{0,120}?c\.sinPresupuesto[\s\S]{0,60}?formatoPesos\(c\.gastado\)/.test(codigo));

  // El rotulo va FUERA del pie. En celular `.saldo-pie` se oculta, asi que si
  // la aclaracion viviera ahi, en un telefono quedaria una cifra grande sola
  // que se lee como saldo disponible. Justo el malentendido a evitar.
  chk('la cifra viene con su rotulo, fuera del pie',
      /saldo-rotulo[\s\S]{0,80}?<\/div>'[\s\S]{0,40}?'<div class="saldo-pie">/.test(codigo));
  // Se mira sobre `html` y NO sobre `codigo`: `codigo` son solo los bloques
  // <script>, asi que ninguna regla de CSS aparece ahi. Buscarla en `codigo`
  // da una comprobacion que no puede pasar nunca.
  chk('y el rotulo NO se oculta en celular, donde el pie si se oculta',
      /@media \(max-width: 480px\)[\s\S]{0,400}?\.saldo-pie\s*{\s*display: none/.test(html) &&
      !/@media \(max-width: 480px\)[\s\S]{0,400}?\.saldo-rotulo[^}]*display: none/.test(html));

  // Un aviso que no se puede resolver deja de leerse, y despues tampoco se lee
  // el que si importa.
  chk('no lo cuenta entre las cuentas "sin configurar"',
      /sinConfigurar = r\.cuentas\.filter\(c => !c\.configurado && !c\.sinPresupuesto\)/.test(codigo));
  chk('ni le pone la franja gris de sin configurar',
      /if \(c\.sinPresupuesto\)\s*clases\.push\('sin-tope'\);\s*\n\s*else if \(!c\.configurado\) clases\.push\('sin-config'\);/.test(codigo));

  // Un fondo sin tope no puede estar sobregirado: no hay de que.
  chk('nunca sale en rojo',
      /const enRojo\s*=\s*c\.configurado && !c\.sinPresupuesto && c\.saldo < 0;/.test(codigo));

  // No hay saldo que editar, y el historial necesita una base para cuadrar.
  chk('no ofrece el lapiz de editar saldo',
      /saldosPuedeEditar && !c\.sinPresupuesto/.test(codigo));
  chk('ni el reloj de movimientos, que sin base no puede cuadrar',
      /c\.configurado && !c\.sinPresupuesto\s*\n\s*\? '<button[^\n]*data-movimientos/.test(codigo));

  // El pie dice cuantas facturas van. Es el dato por el que existe la tarjeta.
  chk('el pie cuenta las facturas registradas',
      /c\.sinPresupuesto\s*\n\s*\? c\.pagos \+ ' factura\(s\) registrada\(s\)'/.test(codigo));

  // Y en el servidor: no se le traslada plata, porque el traslado quedaria
  // escrito en la hoja y despues no apareceria en ninguna pantalla.
  chk('el servidor no lo ofrece como destino de un traslado',
      /\.filter\(c => !CUENTAS\[c\]\.oculto && !CUENTAS\[c\]\.sinPresupuesto\)/.test(gs));
  chk('y ademas lo rechaza si se lo piden por la URL',
      /if \(CUENTAS\[destino\]\.sinPresupuesto\) {/.test(gs));
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
