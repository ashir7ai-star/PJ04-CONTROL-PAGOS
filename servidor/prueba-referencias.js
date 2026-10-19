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

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
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

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
