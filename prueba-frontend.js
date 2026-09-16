// Comprobaciones estáticas de index.html.
// Uso: node prueba-frontend.js index.html
//
// Existe por un error real: una función llamada durante el arranque leía una
// variable `let` declarada más abajo. Eso es un ReferenceError que mata el
// script ENTERO y deja la app en blanco, y ni `node --check` ni un `typeof`
// defensivo lo detectan (las funciones se izan; las `let`/`const` no).

const fs = require('fs');

const RUTA = process.argv[2] || 'index.html';
const html = fs.readFileSync(RUTA, 'utf8');

let fallos = 0;
function chk(nombre, cond, detalle) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre + (cond ? '' : '  → ' + detalle));
  if (!cond) fallos++;
}

// El script inline grande es el último bloque <script> sin src.
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = bloques[bloques.length - 1] || '';

console.log('\n=== Sintaxis ===');
let sintaxisOk = true;
try { new Function(js); } catch (e) { sintaxisOk = false; chk('el script inline compila', false, e.message); }
if (sintaxisOk) chk('el script inline compila', true);

console.log('\n=== Zona muerta temporal en el arranque ===');
// Todo lo que se ejecuta en el nivel superior del script (no dentro de una
// función) corre al cargar. Si esas líneas llaman a una función que lee una
// `let`/`const` declarada DESPUÉS, revienta.
const lineas = js.split('\n');

// El script inline está indentado con 4 espacios, así que "nivel superior" es
// exactamente 4. Con más indentación ya estamos dentro de una función o bloque,
// y esas variables son locales: no pueden causar este problema.
const INDENT = '    ';

const declaradas = new Map();
lineas.forEach((l, i) => {
  const m = l.match(/^ {4}(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (m && !declaradas.has(m[1])) declaradas.set(m[1], i);
});

// Cuerpo y rango de cada función declarada en el nivel superior
const funciones = new Map();
const rangos = [];
lineas.forEach((l, i) => {
  const m = l.match(/^ {4}function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (!m) return;
  let prof = 0, j = i, cuerpo = '', visto = false;
  do {
    cuerpo += lineas[j] + '\n';
    for (const c of lineas[j]) {
      if (c === '{') { prof++; visto = true; }
      if (c === '}') prof--;
    }
    j++;
  } while (j < lineas.length && (!visto || prof > 0));
  funciones.set(m[1], { inicio: i, fin: j, cuerpo: cuerpo });
  rangos.push([i, j]);
});

const dentroDeAlgunaFuncion = (i) => rangos.some(([a, b]) => i >= a && i < b);

// El problema es TRANSITIVO: A() llama a B(), y B lee una variable declarada
// después. Mirar solo el cuerpo de A no alcanza — así se escapó el error real
// (aplicarTema → redibujarBotonGoogle → googleInicializado). Se acumulan los
// cuerpos de todo lo alcanzable desde la función llamada.
function cuerpoAlcanzable(nombre, vistos) {
  vistos = vistos || new Set();
  if (vistos.has(nombre)) return '';          // corta la recursión mutua
  vistos.add(nombre);
  const fn = funciones.get(nombre);
  if (!fn) return '';
  let todo = fn.cuerpo;
  [...fn.cuerpo.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].forEach(m => {
    if (funciones.has(m[1]) && !vistos.has(m[1])) todo += cuerpoAlcanzable(m[1], vistos);
  });
  return todo;
}

// Una llamada "de arranque" es la que está en el nivel superior del script:
// se ejecuta apenas carga la página, en el orden en que aparece.
const problemas = [];
lineas.forEach((l, i) => {
  const m = l.match(/^ {4}([A-Za-z_$][\w$]*)\s*\(\s*[^)]*\)\s*;\s*$/);
  if (!m) return;
  if (dentroDeAlgunaFuncion(i)) return;
  if (!funciones.has(m[1])) return;
  const alcanzable = cuerpoAlcanzable(m[1]);

  // ¿algo de lo que se ejecuta lee una variable de nivel superior declarada DESPUÉS?
  declaradas.forEach((posDecl, nombre) => {
    if (posDecl <= i) return;
    if (funciones.has(nombre)) return;
    const usa = new RegExp('(?<![\\w$.])' + nombre.replace(/\$/g, '\\$') + '(?![\\w$])');
    if (usa.test(alcanzable)) {
      problemas.push('  ' + m[1] + '() se llama en la línea ' + (i + 1) +
                     ' y termina leyendo "' + nombre + '", declarada en la ' + (posDecl + 1));
    }
  });
});

chk('ninguna llamada de arranque lee variables declaradas después',
    problemas.length === 0, '\n' + problemas.join('\n'));

console.log('\n=== Integridad del DOM ===');
const ids = [...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
const setIds = new Set(ids);
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
chk('sin ids duplicados', dup.length === 0, JSON.stringify(dup));

const usados = [...new Set([...js.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))];
const rotos = usados.filter(i => !setIds.has(i));
chk('getElementById siempre apunta a un id existente', rotos.length === 0, JSON.stringify(rotos));

console.log('\n=== Diseño adaptable ===');
// Se quitan los comentarios: si no, un comentario que MENCIONA una propiedad
// (por ejemplo, explicando por qué no usarla) se confunde con la propiedad real.
const css = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// `overflow-x: hidden` en html/body rompe position:sticky, y el encabezado y el
// menú tienen que quedar fijos al hacer scroll (pedido explícito del usuario).
const bloqueHtmlBody = (css.match(/\n\s*html,\s*body\s*\{[^}]*\}/) || [''])[0];
chk('html/body no usa overflow-x:hidden (rompería el menú fijo)',
    !/overflow-x:\s*hidden/.test(bloqueHtmlBody), bloqueHtmlBody.trim());
chk('html/body recorta el desborde horizontal con clip',
    /overflow-x:\s*clip/.test(bloqueHtmlBody), 'falta overflow-x: clip');

// El encabezado y el menú siguen siendo sticky
chk('el encabezado queda fijo al hacer scroll',
    /\n\s*header\s*\{[^}]*position:\s*sticky/.test(css), 'header perdió position:sticky');
chk('el menú queda fijo al hacer scroll',
    /\.app-nav\s*\{[^}]*position:\s*sticky/.test(css), '.app-nav perdió position:sticky');

// Las pestañas tienen que poder deslizarse: si no, la última se corta en celular
chk('las pestañas se deslizan en pantallas angostas',
    /\.app-nav\s*\{[^}]*overflow-x:\s*auto/.test(css), '.app-nav sin overflow-x:auto');

// El alto del encabezado y el `top` del menú fijo tienen que salir de la misma
// variable: si se separan, al hacer scroll el menú se superpone o deja un hueco.
const headerUsaVar = /\n\s*header\s*\{[^}]*height:\s*var\(--header-h\)/.test(css);
const navUsaVar    = /\.app-nav\s*\{[^}]*top:\s*var\(--header-h\)/.test(css);
chk('el encabezado y el menú fijo comparten la misma variable de alto',
    headerUsaVar && navUsaVar,
    'header usa var: ' + headerUsaVar + ', .app-nav usa var: ' + navUsaVar);

// En cada tamaño, el logo tiene que entrar dentro del encabezado.
// Se recorren todos los valores declarados de --header-h y de .brand-logo en el
// orden en que aparecen, que es el orden en que se aplican las media queries.
const altos = [...css.matchAll(/--header-h:\s*(\d+)px/g)].map(m => Number(m[1]));
const logos = [...css.matchAll(/\.brand-logo\s*\{[^}]*width:\s*(\d+)px/g)].map(m => Number(m[1]));
chk('hay un alto de encabezado y un tamaño de logo por cada corte',
    altos.length > 0 && altos.length === logos.length,
    'altos: ' + JSON.stringify(altos) + ' / logos: ' + JSON.stringify(logos));
const noEntra = logos.map((l, i) => ({ logo: l, alto: altos[i] }))
                     .filter(p => !(p.logo < p.alto));
chk('el logo entra en el encabezado en todos los tamaños', noEntra.length === 0,
    JSON.stringify(noEntra));

// Ningún tamaño en línea en el HTML: no se puede adaptar por media query
const enLinea = [...html.matchAll(/style="[^"]*width:\s*\d{2,}px[^"]*"/g)].map(m => m[0]);
chk('sin anchos fijos escritos en línea (no se adaptan)', enLinea.length === 0, JSON.stringify(enLinea));

// Debe haber reglas para celular y para celular angosto
chk('hay reglas para celular (<=640px)',  /@media\s*\(max-width:\s*6[0-4]\d px?\)|@media\s*\(max-width:\s*640px\)/.test(css));
chk('hay reglas para pantallas angostas (<=400px)', /@media\s*\(max-width:\s*4[0-2]\dpx\)/.test(css));

console.log('\n=== Toda clase usada en el HTML existe en el CSS ===');
{
  // Una clase mal escrita no da ningún error: el elemento simplemente queda
  // sin estilo. Ya pasó dos veces — `.btn-secundario` (un botón sin aspecto de
  // botón) y `.upload-icon` en lugar de `.upload-icon-wrap`, que dejó un ícono
  // gigante ocupando media pantalla.
  const cssLimpio = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Clases definidas: cualquier `.nombre` que aparezca en un selector
  const definidas = new Set([...cssLimpio.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1]));

  // Clases usadas: solo las de atributos class="..." literales del HTML.
  // Se excluye lo que provenga de plantillas de JavaScript, donde el valor se
  // arma en tiempo de ejecución y no se puede verificar acá.
  const soloHtml = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const usadas = new Set();
  [...soloHtml.matchAll(/class="([^"{}]+)"/g)].forEach(m => {
    m[1].split(/\s+/).forEach(c => { if (c) usadas.add(c); });
  });

  const huerfanas = [...usadas].filter(c => !definidas.has(c));
  chk('ninguna clase del HTML quedó sin definir en el CSS',
      huerfanas.length === 0, JSON.stringify(huerfanas));
}

console.log('\n=== Toda petición al backend lleva la sesión ===');
{
  // Encontrado en producción el 2026-09-16: "Consultar Pagos" pedía los datos
  // por GET sin token. Con el control de acceso activo el servidor la rechaza
  // y al usuario no le aparecía ningún pago.
  //
  // El token se adjunta SOLO dentro de postAppsScript. Cualquier acción pedida
  // por GET en la URL viaja sin sesión.
  const PUBLICAS_POR_GET = ['estado_login'];   // no revela datos y hace falta antes de tener sesión

  const porGet = [...new Set([...js.matchAll(/\?action=([a-z_]+)/g)].map(m => m[1]))];
  const sinSesion = porGet.filter(a => PUBLICAS_POR_GET.indexOf(a) === -1);
  chk('ninguna acción con datos se pide por GET (viajaría sin token)',
      sinSesion.length === 0, JSON.stringify(sinSesion));

  // Y que no haya fetch sueltos al backend armando la URL a mano.
  // `fetch(APPS_SCRIPT_URL, {...})` es el de postAppsScript y es el correcto;
  // `fetch(APPS_SCRIPT_URL + '?...')` construye un GET que viaja sin sesión.
  const conUrlArmada = [...js.matchAll(/fetch\(APPS_SCRIPT_URL\s*\+\s*'([^']*)'/g)].map(m => m[1]);
  const fuera = conUrlArmada.filter(u => !/estado_login/.test(u));
  chk('no hay GET al backend armados a mano fuera de postAppsScript',
      fuera.length === 0, JSON.stringify(fuera));
}

console.log('\n=== Service Worker ===');
let sw = null;
try { sw = fs.readFileSync('sw.js', 'utf8'); } catch (e) { /* puede no estar al lado */ }
if (sw) {
  // Si el Service Worker intercepta las peticiones a Apps Script, rompe la
  // redirección con la que Google entrega la respuesta de un POST y el backend
  // termina viendo "action: undefined". Costó una sesión entera encontrarlo.
  const hosts = ['script.google.com', 'script.googleusercontent.com', 'accounts.google.com'];
  hosts.forEach(h => {
    chk('el Service Worker deja pasar ' + h, sw.indexOf(h) !== -1,
        'falta en la lista de dominios sin cachear');
  });
  chk('el Service Worker filtra por dominio antes de responder',
      /hostname/.test(sw), 'no hay ningún filtro por hostname en el fetch');
  // La versión de caché tiene que subir en cada cambio, o nadie recibe nada
  chk('sw.js declara una versión de caché', /const CACHE = 'control-pagos-v\d+'/.test(sw));
}

console.log('\n=== Coherencia con el backend ===');
const clienteFront = (html.match(/const CLIENT_ID_GOOGLE = '([^']+)'/) || [])[1];
let clienteBack = null;
try {
  clienteBack = (fs.readFileSync('apps-script.gs', 'utf8').match(/const CLIENT_ID_GOOGLE = '([^']+)'/) || [])[1];
} catch (e) { /* el .gs puede no estar al lado */ }
if (clienteBack) {
  // Si no coinciden, el servidor rechaza TODOS los tokens por el chequeo de "aud"
  // y el login falla entero sin una causa evidente.
  chk('el Client ID coincide entre index.html y apps-script.gs',
      clienteFront === clienteBack, clienteFront + ' vs ' + clienteBack);
}

console.log('\n' + (fallos ? 'FALLARON ' + fallos + ' comprobaciones' : 'TODAS LAS COMPROBACIONES PASARON'));
process.exit(fallos ? 1 : 0);
