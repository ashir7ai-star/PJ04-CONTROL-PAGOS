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


console.log('\n=== Los iconos de la lista de archivos existen ===');
['svgFile', 'svgImage', 'svgTrash'].forEach(n => {
  const usos = (codigo.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
  const decl = new RegExp('(?:const|let|var)\\s+' + n + '\\b').test(codigo);
  chk(n + ' está declarado (' + usos + ' usos)', decl, 'usado pero nunca declarado');
});

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
