# Contexto del Proyecto — Control de Pagos (PJ04)

> Documento vivo. Se actualiza cada vez que se hace un cambio relevante para que cualquier sesión (o persona) pueda retomar el proyecto sin perder contexto.

## 🧭 PENDIENTE: cargar los saldos (orden acordado con el usuario)
**No cargar los saldos todavía.** El usuario primero va a registrar en el sistema todos los comprobantes atrasados: compras y pagos que ya se hicieron en la vida real pero que aún no están cargados.

**Por qué ese orden importa:** el saldo solo descuenta los pagos registrados **después** de la base. Si se cargara el saldo primero y después se metieran los comprobantes atrasados, el sistema los restaría a todos y el saldo quedaría por debajo del real — aunque el banco ya los había descontado. Haciéndolo al revés, la base nace cuadrada.

**Secuencia correcta:**
1. Registrar en el sistema todos los pagos/compras atrasados.
2. Recién entonces, con los extractos a la vista, cargar los cuatro saldos desde el lápiz de cada tarjeta.
3. A partir de ahí, cada pago nuevo descuenta solo.

Conviene cargar las cuatro cuentas el mismo día y no registrar pagos mientras se hace.

## 🧪 Bancos de pruebas (correr ante cualquier cambio)
```
node prueba-frontend.js index.html      # TDZ, DOM, diseño adaptable, Service Worker, sesión en cada llamada
node prueba-permisos.js apps-script.gs  # permisos por sección, endpoints sin validar sesión
node prueba-saldos.js   apps-script.gs  # aritmética del dinero y quién ve cada saldo
node prueba-consulta.js                 # consulta de extremo a extremo + alta completa de cada tipo de pago
```
**Verificar siempre que una prueba nueva pueda FALLAR**, reintroduciendo el defecto a propósito. Ya hubo dos casos de pruebas que pasaban sin comprobar nada real (la de saldos bancarios y la de tipos de pago), y una prueba que no puede fallar da confianza sin respaldarla.

## Última actualización
**2026-09-16** — ✅ **VERSIÓN ESTABLE** (tag `v1.3-materiales`). Acceso **restringido** (`MODO_LOGIN = 'estricto'`): solo entran los usuarios registrados y activos. Incluye la sección **Compra Materiales**, los **saldos por cuenta** con visibilidad según rol, la **sesión que se recuerda y se renueva sola**, el arranque instantáneo, y el diseño adaptable a celular. `APPS_SCRIPT_URL` apunta al despliegue **`AKfycbxDRCP3efj…`** (el anterior dejó de tomar el código). `sw.js` → `control-pagos-v57`.

**Pendientes:** cargar los cuatro saldos (después de registrar los comprobantes atrasados), mudar el dominio a `pagos.energy-millennium.com` (bloqueado por acceso a Wix), y el botón "Agregar factura" de Consultar Pagos, que nunca se construyó.

**2026-09-16** — ✅ Versión estable anterior (tag `v1.2-saldos`). Incluye la **Fase 2 operativa** (login con Google, hoja `USUARIOS` con roles ya cargados a mano por el usuario, sección Configuración, sesión que se recuerda entre recargas) y el **panel de saldos** por cuenta. `MODO_LOGIN` sigue en **`'suave'`**: quien inicia sesión ve solo lo suyo, pero quien no la inicia todavía entra. Pasar a `'estricto'` cuando el usuario lo indique. Pendientes anotados arriba: **cargar los saldos** (después de meter los comprobantes atrasados) y **mudar el dominio** (bloqueado por acceso a Wix). `sw.js` → `control-pagos-v44`.

**2026-09-15** — ✅ **VERSIÓN ESTABLE, Fase 1 completa y en producción** (tag de git `v1.0-fase1`). n8n quedó fuera del sistema por completo: "Nuevo Pago" y "Consultar Pagos" usan el mismo **Google Apps Script Web App** que ya usaba Aprobaciones. Cada tipo de pago tiene **su propia hoja en el Sheet y su propia carpeta en Drive**, con dos tipos nuevos (**Seguridad Social** y **Pago Nómina**). La migración de datos históricos **ya se ejecutó y se concilió**. `sw.js` → `control-pagos-v32`. Lo siguiente es la **Fase 2: login con Google + hoja `USUARIOS`**.

## ⚠️ Nota operativa: el hook de auto-push puede fallar en silencio (NO RESUELTO DEL TODO — seguir verificando)
El 2026-08-30/31 el hook de `Stop` hizo el commit local pero **no llegó a subirlo a GitHub** tres veces seguidas (branch quedó "ahead of origin" sin ningún mensaje de error visible), incluso después de subir el timeout de 30s a 60s (no era problema de tiempo).

**Causa raíz parcial confirmada:** el hook corría con `"shell": "powershell"`. Ese entorno tiene seteadas `GCM_INTERACTIVE=never` y `GIT_TERMINAL_PROMPT=0` (para que ningún comando se cuelgue esperando un prompt interactivo) — pero esto también le impide a Git Credential Manager acceder/refrescar el login guardado de GitHub, y el `push` falla de inmediato con `fatal: Cannot prompt because user interactivity has been disabled` / `terminal prompts disabled`. Se reprodujo de forma directa y consistente por PowerShell; por Bash nunca falló en las pruebas manuales.

**Fix aplicado (2026-08-31):** se cambió el hook de `Stop` en `.claude/settings.local.json` de `"shell": "powershell"` a `"shell": "bash"` (comando traducido a sintaxis POSIX). Mismo `timeout: 60`.

**⚠️ 2026-09-10: volvió a pasar incluso con `shell: bash`.** El commit se hizo bien, el push quedó sin subir otra vez (branch "ahead of origin by 1"), confirmado con `git log origin/main..HEAD`. Se subió manualmente sin problema (igual que siempre al hacerlo a mano). Osea: el cambio a Bash resolvió la causa de credenciales de PowerShell, pero **no es la única causa** — sigue habiendo algo (posiblemente el proceso del hook cortándose por el ciclo de vida del host/VSCode, no por timeout ni por credenciales) que hace que el `push` no siempre se complete.

**Mientras esto no quede resuelto de raíz:** al empezar cualquier sesión nueva, o si el usuario dice "no veo mis cambios", correr `git status` + `git fetch origin` + `git log origin/main..HEAD --oneline` para confirmar si hay un push pendiente, y subirlo manualmente (`git push origin main`) — no asumir que el hook lo hizo solo, aunque el `shell` ya esté en `bash`.

## Qué es este proyecto
PWA (app web instalable, sin build ni framework) para **Millennium Energy Co** que permite:
1. Registrar pagos (a proveedores o de impuestos) con adjunto de archivo.
2. Consultar pagos registrados con filtros (empresa, tipo, proveedor, N° factura, rango de fechas).

Todo vive en un único [index.html](index.html) (HTML + CSS + JS inline).

## Arquitectura
| Pieza | Detalle |
|---|---|
| Frontend | `index.html` — una sola página, sin dependencias de build |
| Backup estable | `index.stable.html` — copia de respaldo de la última versión considerada estable |
| PWA | `manifest.json` (scope `/PJ04-CONTROL-PAGOS/`) + `sw.js` (Service Worker, cache-first, versión de caché actual: `control-pagos-v32`) |
| Backend | **Google Apps Script Web App** (`APPS_SCRIPT_URL`), una sola URL para todo el sistema, ruteada por el parámetro `action`. **n8n ya no se usa en ninguna parte** (2026-09-15). |
| — Registrar pago | `POST` `{action:'registrar_pago'}` → `registrarPago_()` — sube los adjuntos a la carpeta de la sección y escribe la fila en la hoja de la sección |
| — Consultar pagos | `GET ?action=consultar_pagos` → `consultarPagos_()` — consolida **todas** las hojas de pagos |
| — Aprobaciones | `solicitar_aprobacion`, `consultar_solicitudes`, `decidir_solicitud` |
| Almacenamiento real | Google Sheet "CONTROL DE PAGOS" (una hoja por sección) + Google Drive (una carpeta por sección) — ver "🗂️ Una hoja y una carpeta por sección". La hoja principal se resuelve por **posición** (`getSheets()[0]`, vía `hojaPrincipal_()`), no por nombre, porque el nombre real de la pestaña cambió tras la migración de cuenta y no es confiable. |
| Reporte diario | Mismo proyecto de Apps Script — ver sección "📧 Reporte diario automático" |
| Hosting | GitHub Pages (por el `scope`/`start_url` del manifest) |
| Repo | https://github.com/ashir7ai-star/PJ04-CONTROL-PAGOS |

## ✅ Módulo de Aprobaciones — 2026-09-15, **desplegado y en producción**

**Web App URL (en `APPS_SCRIPT_URL` de index.html):**
`https://script.google.com/macros/s/AKfycbyDHauDZGvZ1CSH3WOY9h-JLnxoKYcRBdV4v7hpPjDW86kK27o3ieFk01ggpBOmHA4-nA/exec`
Desplegado como Web app · Execute as: Me · Who has access: Anyone. Verificado con `curl` (devuelve `[]`). Nota: si se prueba con `curl` sin User-Agent de navegador, Google devuelve HTML en vez del JSON — no es un error de la app, hay que mandar `-H "User-Agent: Mozilla/5.0"`.

### 🚫 Decisión de arquitectura: NO usar n8n (2026-09-15)
El usuario pidió explícitamente **no depender de n8n en este módulo ni en desarrollos futuros**. Por eso el backend de Aprobaciones se implementó como un **Google Apps Script Web App**, en el MISMO proyecto de Apps Script que ya existe en el Sheet (el de los reportes diario/mensual). Ventajas: ya está en la cuenta correcta, tiene acceso nativo a Sheets/Drive/Gmail, y el código lo escribe Claude completo (a diferencia de n8n, que requería armar nodos a mano en su GUI).

**Actualización 2026-09-15:** los módulos viejos (Nuevo Pago, Consultar Pagos) **ya se migraron también** a Apps Script como parte de la Fase 1. n8n quedó fuera del sistema por completo. El único resto es `N8N_ADDFILE_URL`, un webhook de "Agregar factura" que **nunca llegó a construirse**; el botón sigue mostrando el aviso de "función no disponible" y está pendiente de rehacerse sobre Apps Script.

### Qué es
Tercera pestaña del menú (`Nuevo Pago · Consultar Pagos · Aprobaciones`). Le da a la empresa un flujo de **solicitud → revisión → decisión** para pagos/compras, en vez de registrarlos directo. Decisiones de diseño confirmadas por el usuario:
- **Quién solicita:** cualquier persona con acceso al sistema (link completo o `?vista=gastos`), para cualquier tipo de pago — no se restringe por tipo, a diferencia de "Nuevo Pago" en la vista `?vista=gastos`.
- **Quién revisa/decide:** solo los administradores (Nathan, Joseph) — el sub-tab "Revisar Solicitudes" se oculta por completo cuando `vistaRestringida === 'gastos'` (mismo mecanismo de ocultar-en-pantalla ya usado en el resto de la app, mismo tradeoff de seguridad aceptado).
- **Al aprobar: NO se registra nada en "Control de Pagos".** La aprobación es **solo un visto bueno visual** — cambia el estado de la solicitud a "Aprobado" y se le notifica al solicitante, nada más. (El usuario lo pidió así explícitamente el 2026-09-15, corrigiendo un diseño anterior donde sí se auto-registraba: *"lo que quiero es algo únicamente visual donde el usuario vea que el administrador está de acuerdo con la compra"*. **No volver a implementar el auto-registro sin que lo pida.**)
- **Notificaciones:** correo a los administradores por cada solicitud nueva; correo al solicitante (campo "Correo" nuevo en el formulario) cuando se aprueba o rechaza, incluyendo el motivo si fue rechazada.

### Frontend ya implementado en `index.html`
- **Sub-tabs internos** (`#aprobacionesSubTabs`): "Nueva Solicitud" (formulario, visible siempre) / "Revisar Solicitudes" (cola de revisión, oculta en `?vista=gastos`).
- **Formulario "Nueva Solicitud"** (`#solicitudForm`): mismos campos que "Nuevo Pago" (selector de 6 tipos, empresa, nombre del pago, proveedor, fecha, valor, notas, archivo(s)) **más un campo nuevo "Correo"** (`#correoSolicitante`, para la notificación de la decisión).
- **Panel "Revisar Solicitudes"**: filtros por estado (Pendientes/Aprobadas/Rechazadas/Todas, `#estadoFilterTabs`) + tarjetas (`.solicitud-card`) con toda la info, badge de estado, y para las Pendientes botones **Aprobar** (verde, pide confirmación nativa `confirm()`) / **Rechazar** (abre modal `#rechazoOverlay` pidiendo motivo obligatorio, que se envía como `comentario`).
- **Quién aprueba/rechaza queda registrado** vía `localStorage` (`nombreRevisor()`): la primera vez que alguien aprueba/rechaza en un navegador, se le pide su nombre con un `prompt()` una sola vez y se recuerda para las siguientes veces — no es login real, es solo para completar la columna "Revisado por".
- **Refactor asociado** (para no duplicar lógica entre el formulario de "Nuevo Pago" y el de "Nueva Solicitud"): se extrajeron `initSelectorTipo(scope, hiddenInputId)`, `initUploadZone(zoneId, inputId, previewListId)` (devuelve `{getFiles, reset}`) e `initFormateadorValor(inputId)`, usados por ambos formularios. **Importante:** `tipoBtns`/`tipoHidden` (Nuevo Pago) y `tipoBtnsSolicitud`/`tipoHiddenSolicitud` (solicitud) son ahora resultado de destructuring de `initSelectorTipo(...)` — si se toca ese bloque, cuidado con romper ambos formularios a la vez.

### Cómo habla el frontend con el backend
Una sola constante en `index.html`:
```js
const APPS_SCRIPT_URL = 'PENDIENTE_CONFIGURAR';   // ← pegar aquí la URL /exec del Web App
```
Mientras siga así, la app muestra un toast de "Función no configurada" en vez de romperse — no afecta a "Nuevo Pago"/"Consultar Pagos" existentes (que siguen en n8n).

Las 3 operaciones van por la MISMA URL, distinguidas por el parámetro `action`:
| Operación | Método | Cómo se llama |
|---|---|---|
| Crear solicitud | POST | `{ action: 'solicitar_aprobacion', ...campos, archivos: [{nombre, tipo, datos}] }` |
| Consultar solicitudes | GET | `?action=consultar_solicitudes` |
| Aprobar / rechazar | POST | `{ action: 'decidir_solicitud', id, decision, revisado_por, comentario }` |

**Dos detalles técnicos importantes del frontend (helpers `postAppsScript()` y `fileToBase64()`):**
1. Los archivos se mandan **en base64 dentro del JSON**, no como `multipart/form-data` — Apps Script maneja mal el multipart posteado desde un `fetch()` externo, mientras que base64 + JSON es el patrón confiable y documentado.
2. Los POST se envían con `Content-Type: text/plain;charset=utf-8` **a propósito**: con `application/json` el navegador dispara un preflight CORS (OPTIONS) que los Web Apps de Apps Script no responden bien. El cuerpo sigue siendo JSON y se parsea igual con `JSON.parse(e.postData.contents)` del otro lado. **No "corregir" esto a application/json** — rompería las llamadas.

### Modelo de datos — pestaña **"SOLICITUDES DE APROBACION"** (la crea el script solo si no existe)
`ID SOLICITUD` · `FECHA SOLICITUD` · `EMPRESA` · `TIPO DE PAGO` · `NOMBRE DEL PAGO` · `PROVEEDOR` · `FECHA DE PAGO` · `VALOR` · `SOLICITADO POR` · `CORREO` · `NOTAS` · `URL ARCHIVO` · `ESTADO` · `REVISADO POR` · `FECHA DECISION` · `COMENTARIO`

- `ID SOLICITUD` y `FECHA SOLICITUD` guardan ambos el `fecha_envio` en ISO con milisegundos (mismo patrón que `ID REGISTRO`); el ID sirve para hacer match al aprobar/rechazar, y el frontend ordena por fecha con `new Date(...)`.
- `ESTADO` arranca en `Pendiente` y pasa a `Aprobado`/`Rechazado`.
- El script escribe usando los **encabezados reales** de la hoja (`agregarFilaPorEncabezados_`), así que el orden de las columnas puede cambiar sin romper nada.

### El backend: `apps-script.gs` (en el repo)
[apps-script.gs](apps-script.gs) contiene el **proyecto de Apps Script COMPLETO** — bloque A (reportes diario/mensual, que ya existían) + bloque B (Aprobaciones). **Ese archivo no se ejecuta desde el repo**: es la copia espejo de lo que está pegado en el editor de Apps Script del Sheet. Al editar de un lado, actualizar el otro. Para pegarlo en Google se reemplaza el contenido completo del editor, no se anexa.

Funciones principales: `doGet`/`doPost` (enrutan por `action`), `crearSolicitud_`, `consultarSolicitudes_`, `decidirSolicitud_`, más helpers (`hojaSolicitudes_`, `carpetaFacturas_`, `subirArchivos_`, `agregarFilaPorEncabezados_`, `notificarAdmins_`, `notificarSolicitante_`). Convive sin colisiones con las funciones de reportes que ya estaban (`enviarReporteDiario`, `enviarReporteMensual`, etc.).

### Pasos de instalación (pendientes)
1. Sheet "CONTROL DE PAGOS" → **Extensiones → Apps Script**.
2. Pegar el contenido de `apps-script.gs` **al final** del archivo existente (sin borrar las funciones de reportes). Verificar que no exista ya otro `doGet`/`doPost` en el proyecto — solo puede haber uno de cada.
3. **Deploy → New deployment → Web app** — Execute as: **Me**, Who has access: **Anyone** → Deploy → autorizar permisos (Drive, Sheets, Gmail).
4. Copiar la URL que termina en `/exec` y pegarla en `APPS_SCRIPT_URL` en `index.html`.
5. Bump de `sw.js`, sync de `index.stable.html`, commit+push.

⚠️ **Gotcha de Apps Script (nos pasó el 2026-09-15):** al editar el código, los cambios NO llegan solos al Web App. Hay que ir a **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. Si en vez de eso se usa **Deploy → New deployment**, Google crea un despliegue **nuevo con otra URL** y la app se queda apuntando al viejo (código desactualizado) sin ningún error visible.

**Cómo detectarlo:** comparar el *Deployment ID* que muestra Google contra la URL que tiene `APPS_SCRIPT_URL` en `index.html`. Si difieren, se creó uno nuevo → o se actualiza la constante en el frontend (lo que hicimos), o se archiva el nuevo y se edita el original. Hay un despliegue viejo huérfano (`AKfycbyM5KRU3a15...`) que quedó sirviendo la Versión 1; es inofensivo, pero se puede archivar desde Manage deployments.

### Alcance intencional: el módulo es solo el visto bueno
Aprobar **no** crea ningún registro en "Control de Pagos" ni dispara ningún pago — solo deja constancia de que un administrador estuvo de acuerdo, visible para el solicitante (y por correo). Si después ese pago se ejecuta de verdad, alguien lo registra aparte por "Nuevo Pago", como siempre. Esto quedó zanjado el 2026-09-15 y la pregunta anterior sobre qué poner en "Registrado por" al aprobar ya no aplica.

## 🔗 Vista restringida por link (Viáticos / Caja Menor) — 2026-09-10

### Qué se pidió
Dar acceso al sistema a dos personas nuevas, cada una responsable de un tipo de gasto (Viáticos, Caja Menor), pero **sin que puedan ver los demás pagos registrados** (proveedores, compras, impuestos, etc. de las dos empresas).

### Decisión de diseño (elegida explícitamente por el usuario)
El sistema **no tiene login/usuarios** — es una sola página estática. Se le ofrecieron dos opciones:
1. Link privado + filtrado real en el servidor (más seguro, requiere tocar n8n).
2. Link privado + solo ocultar en pantalla (más simple, **elegida**).

**Implicación de seguridad importante, ya comunicada al usuario:** con la opción elegida, el navegador de estas dos personas **sigue recibiendo TODOS los registros** desde `N8N_QUERY_URL` — el filtrado pasa solo en JavaScript, en el cliente. Alguien con conocimientos técnicos (F12 → pestaña Network) podría ver la respuesta completa con todos los pagos, no solo los suyos. Esto es aceptado como riesgo asumido, no es un bug pendiente de arreglar — si en el futuro se quiere subir el nivel de seguridad, hay que migrar a la opción 1 (filtrar en n8n antes de responder).

### Cómo funciona
- Se agregaron dos tipos de pago nuevos: **`viaticos`** ("Viáticos") y **`caja_menor`** ("Caja Menor"), como dos botones más en el selector de "Tipo de pago" de `index.html` (ahora 6 tipos en total), con sus propios badges de color (`.badge-viaticos`, `.badge-caja`).
- **Un solo parámetro de URL: `?vista=gastos`** (simplificado el 2026-09-10 — originalmente eran dos links separados por tipo, `?vista=viaticos` / `?vista=caja_menor`, pero el usuario pidió unificarlos ya que las dos personas nuevas pueden compartir el mismo link). Al detectarlo (`vistaRestringida === 'gastos'` en el `<script>`, constante `TIPOS_GASTOS = ['viaticos', 'caja_menor']`), la página:
  - En "Nuevo Pago": oculta los 4 botones de tipo originales (Pago a Proveedor, Compra, Venta, Pago Impuestos) y deja visibles solo "Viáticos" y "Caja Menor" — el usuario elige entre esos dos con el flujo normal de clic (no hay auto-selección, porque ahora hay una elección real entre dos opciones).
  - En "Consultar Pagos": reemplaza las opciones del `<select>` de "Tipo de pago" para que solo ofrezca "Todos" (dentro del universo de gastos), "Viáticos" o "Caja Menor" — y `filtrarRows()` aplica además un filtro duro (`TIPOS_GASTOS.some(t => rTipo.includes(t))`) que excluye cualquier fila que no sea de esos dos tipos, sin importar el resto de filtros.
  - Cambia títulos/subtítulos y etiquetas de navegación a "Nuevo Gasto" / "Consultar Gastos".
- El link a repartir a las dos personas nuevas (el mismo para ambas):
  - `https://ashir7ai-star.github.io/PJ04-CONTROL-PAGOS/?vista=gastos`
- El link normal (sin `?vista=`) sigue mostrando todo, sin restricciones — para el usuario con acceso completo.

### ⚠️ Limitación conocida: instalar como PWA (ícono en el celular)
`manifest.json` tiene un `start_url` fijo (`/PJ04-CONTROL-PAGOS/`, sin query string). Si alguna de las dos personas restringidas intenta "Agregar a pantalla de inicio" desde `?vista=gastos`, es probable que el ícono instalado abra la app en la URL del `start_url` del manifest — es decir, **la vista completa sin restricción**, no la vista acotada. Por ahora, hay que indicarles que usen el link como marcador/acceso directo del navegador, no que lo "instalen" como PWA. Si se quiere un ícono propio en el celular que sí respete la restricción, hay que crear un manifest separado para esta vista y cambiar dinámicamente el `<link rel="manifest">` según el parámetro — no implementado todavía, pendiente si se pide.

## 📤 Exportar consulta (Excel/PDF) — 2026-09-14
En "Consultar Pagos" (y su variante restringida "Consultar Gastos" con `?vista=gastos`), el encabezado de resultados tiene dos botones nuevos: **Excel** y **PDF**, que descargan exactamente los resultados que se están viendo en pantalla en ese momento (respetando todos los filtros activos — empresa, tipo, proveedor, N° de pago, rango de fechas — y, si aplica, el bloqueo de tipo de la vista restringida).

- **100% client-side, sin backend ni n8n.** Se usan dos librerías cargadas por CDN (jsdelivr, mismo proveedor que flatpickr) y precacheadas en `sw.js` para que funcionen también offline en la PWA instalada:
  - [SheetJS/xlsx](https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js) para generar el `.xlsx`.
  - [jsPDF](https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js) + [jspdf-autotable](https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js) para el `.pdf`.
- **De dónde salen los datos:** `ultimosResultados` (variable global en `index.html`) se actualiza cada vez que `renderResultados()` corre — siempre son los resultados de la última búsqueda ejecutada, no todo el sistema.
- **Contenido de ambos archivos:** encabezado "Millennium Energy Co" + título dinámico (toma el texto de `#searchTitle`, así que dice "Consultar Pagos" o "Consultar Gastos" según la vista), línea con el resumen de filtros activos (`resumenFiltros()`), fecha/hora de generación, tabla con las mismas columnas que se ven en pantalla, y una fila de TOTAL al final.
- **Nombre de archivo:** `<Título_reporte>_<fecha>_<hora>.xlsx|pdf`, ej. `Consultar_Pagos_2026-09-14_1530.xlsx`.
- **Refactor asociado:** se extrajeron los helpers `tipoInfo(tipoRaw)` (antes duplicado en dos sitios) y `valorDe(r)`, reusados tanto en `renderResultados()` como en las funciones de exportación — evita que la lógica de tipos/badges se desincronice entre la tabla en pantalla y lo exportado.
- **Limitación conocida:** SheetJS en su edición gratuita (`xlsx.full.min.js`) no soporta negrita/colores al escribir — el Excel exportado tiene fusión de celdas para el título pero sin formato de texto en negrita. El PDF sí tiene estilo completo (colores, encabezado azul corporativo, numeración de páginas) porque jsPDF+autotable no tiene esa restricción.

## 📧 Reportes automáticos (Google Apps Script, sin n8n)
Para evitar depender de n8n y como salvaguarda tras el incidente de la cuenta eliminada, se configuraron dos reportes automáticos **directamente en Google Apps Script**, vinculados al Google Sheet "CONTROL DE PAGOS":

- **Dónde vive:** Extensiones → Apps Script, dentro del propio Sheet (proyecto "Untitled project", archivo `Code.gs`). No es parte de este repositorio ni de n8n — vive en la cuenta de Google dueña del Sheet.
- **`enviarReporteDiario()`**: filtra solo las filas cuya `FECHA REGISTRO` es el día de hoy, arma un Sheet temporal solo con esas filas, lo exporta a PDF+XLSX y lo borra. Trigger: Time-driven → Day timer (ya activo).
- **`enviarReporteMensual()`**: filtra las filas del **mes anterior completo** (calculado como `hoy - 1 mes`, pensado para correr el día 1 de cada mes y reportar el mes que acaba de cerrar). Mismo mecanismo de Sheet temporal → PDF+XLSX. Trigger: Time-driven → Month timer, día 1.
- Ambas comparten helpers: `leerDatos_()` (lee toda la hoja a objetos por encabezado), `parseFechaRegistro_()` (soporta que la celda sea texto `dd/MM/yyyy HH:mm` o ya un objeto Date), `mismoDia_()`/`mismoMes_()`, `generarArchivos_()` (crea el Sheet temporal, exporta PDF+XLSX vía las URLs nativas `/export?format=pdf|xlsx` con `UrlFetchApp` + token OAuth del script, y lo manda a la Papelera), y `totalValor_()` (suma la columna `VALOR FACTURA`).
- **Destinatarios (ambos reportes):** `nathan@ylevigroup.com`, `joseph@ylevigroup.com`, `contabilidad@energy-millennium.com` (array `DESTINATARIOS` al inicio del script — para agregar/quitar correos, editar ahí).
- **Alcance intencional:** cubren solo los **datos del Sheet** (registro de pagos), no hacen copia de las facturas en Drive — el usuario prefirió descargarlas manualmente si las necesita, para no complicar el script con zips/tamaños de adjuntos.
- **Para modificarlo:** entrar al Sheet → Extensiones → Apps Script → `Code.gs`.

## 🔧 Pendiente en n8n: soporte para varios archivos + "Agregar factura" (iniciado 2026-08-18)

### Contexto
Se implementó en `index.html` (frontend, ya en producción):
1. **"Nuevo Pago"**: el input de archivo ahora acepta múltiples (`multiple`), con lista de previsualización y opción de quitar cada uno. Al enviar, cada archivo se agrega al `FormData` bajo el mismo campo `archivo` (varias veces, una por archivo) — esto es intencional: cuando el Webhook de n8n recibe multipart/form-data con varios archivos bajo el mismo nombre de campo, **los indexa automáticamente como `archivo0`, `archivo1`, `archivo2`, ...** en las propiedades binarias del item.
2. **"Consultar Pagos"**: cuando un registro no tiene archivo (columna "Archivo" = "—"), ahora se muestra un botón **"+ Agregar"** que abre un modal para subir el/los archivo(s) faltantes. Al confirmar, hace `POST` a una nueva constante `N8N_ADDFILE_URL` (todavía sin configurar — ver abajo) con `FormData`: `id` (identificador del registro) + uno o más `archivo`.

**Diseño de identificador de registro:** el botón "+ Agregar" solo aparece si la fila trae un campo `r['ID REGISTRO']` desde el webhook de consulta. Ese campo **no existe todavía** en el Google Sheet — hay que agregarlo (ver pasos abajo). Hasta que se agregue, el botón simplemente no aparece para ningún registro (no rompe nada, pero la función 2 sigue inactiva).

### Pasos pendientes en n8n (dos piezas)

**A) Que "Nuevo Pago" procese varios archivos (no solo el primero)**
Hoy el nodo "Upload file" solo lee la propiedad binaria fija `archivo0`. Para soportar varios:
1. Insertar un nodo **Code** entre el Webhook y "Upload file" que, por cada item de entrada, recorra `$input.item.binary` (claves `archivo0`, `archivo1`, ...) y genere **un item de salida por archivo**, cada uno con el binario renombrado a una clave fija (ej. `file`) y copiando el `json.body` original.
2. Cambiar "Input Data Field Name" del nodo **Upload file** a `file` (coincidiendo con el Code node). n8n ejecuta automáticamente el nodo una vez por cada item de entrada, así que subirá todos los archivos.
3. Agregar un nodo **Aggregate** (o **Code**) después de "Upload file" que junte todos los `webViewLink` resultantes en un solo string (ej. separados por salto de línea), conservando el resto de campos del body original.
4. El nodo **Append row in sheet** usa ese string combinado como valor de `URL ARCHIVO`.
5. De paso, agregar una nueva columna **"ID REGISTRO"** en el Sheet "Control de pagos" (pestaña "Millennium"), mapeada en "Append row in sheet" a `{{ $('Webhook').item.json.body.fecha_envio }}` (ya se envía desde el frontend, con precisión de milisegundos — sirve como identificador único de cada registro).

**B) Nuevo workflow: "Agregar Factura" (feature nueva)**
1. Nuevo **Webhook** (POST, multipart/form-data): recibe `id` + uno o más `archivo`.
2. Mismo patrón Code → Upload file (Drive, misma carpeta "PJ04 FACTURAS") → Aggregate, para soportar varios archivos igual que en (A).
3. Nodo **Google Sheets** con operación **"Update Row"** (o "Append or Update Row"): "Column to Match On" = `ID REGISTRO`, valor a buscar = `{{ $('Webhook').item.json.body.id }}`; columna a actualizar: `URL ARCHIVO` = el/los link(s) combinados.
4. **Respond to Webhook** devolviendo `{ "status": "success" }`.
5. Copiar la URL del Webhook resultante y pegarla en `index.html`, reemplazando el placeholder:
   ```js
   const N8N_ADDFILE_URL = 'PENDIENTE_CONFIGURAR_EN_N8N';
   ```
6. Avisar para actualizar ese valor en el código, bumpear `sw.js`, y sincronizar `index.stable.html`.

**Nota:** el diseño de "Agregar factura" hace *replace* de `URL ARCHIVO` (no combina con un archivo previo) — pensado específicamente para el caso "se registró el pago pero faltó subir el soporte". Si más adelante se quiere permitir agregar archivos adicionales a un registro que ya tiene uno, hay que ajustar el paso 3 para leer el valor actual antes de sobreescribir.

## ⚠️ Incidente (RESUELTO): cuenta de Google del backend eliminada (2026-07-30 → 2026-08-04)
La cuenta de Google donde vivían el Drive ("PJ04 FACTURAS") y el Sheet ("Control de pagos") que usa n8n para el backend **fue eliminada por error**. Esto rompió el workflow de registrar pagos con errores 404 en cadena:
- Nodo **Upload file** (Google Drive): `File not found: <id de carpeta>` — la carpeta destino ya no existía para la credencial.
- Nodo **Append row in sheet** (Google Sheets): `Requested entity was not found` — el spreadsheet/pestaña destino tampoco existía.
- Después, al recrear el Sheet nuevo con encabezados ligeramente distintos (ej. "TIPO FACTURA" → "TIPO DE FACTURA"), salió un tercer error: `Column names were updated after the node's setup` (schema drift), porque el nodo tenía cacheados los nombres de columna viejos.

**Resolución (2026-08-04):**
- Cuenta de Google nueva creada, credenciales reconfiguradas en Google Cloud Console y en n8n ("PJ04 DRIVE", "PJ04 SHEET").
- Carpeta "PJ04 FACTURAS" y Sheet "Control de pagos" (pestaña "Millennium") recreados bajo la cuenta nueva; nodos re-apuntados.
- Encabezados del Sheet ajustados para volver a coincidir exactamente con lo que espera el nodo/la app (`FECHA REGISTRO`, `TIPO FACTURA`, etc. — el frontend en `index.html` depende del texto exacto `'TIPO FACTURA'` para el filtro y badge de tipo de pago, así que cualquier rename de esa columna en el Sheet rompería esa lógica sin tocar código).
- Usuario confirmó que ya quedó funcionando end-to-end y pidió marcar como versión estable.

**Lecciones aprendidas:**
1. Cuando un nodo de Google Drive/Sheets en n8n da 404 "File/entity not found" pese a que el nombre se ve correcto en el dropdown, es porque el ID cacheado en el parámetro no coincide con el recurso real — hay que reabrir el dropdown "From list" y volver a hacer clic explícito sobre el recurso para refrescar el ID (no basta con que se vea seleccionado).
2. Si se recrea el Google Sheet, los encabezados de columna deben coincidir **exactamente** (mismo texto) con los que ya usa `index.html` (notablemente `'TIPO FACTURA'`, referenciado en `filtrarRows()` y `renderResultados()`) y con los que espera el nodo "Append row in sheet" — de lo contrario hay que refrescar el schema en n8n y/o actualizar el frontend.

## ⚠️ Regla importante: actualizar el Service Worker en cada cambio visible
Cada vez que se modifique `index.html` (o cualquier asset cacheado), **hay que subir el número de versión de `CACHE` en `sw.js`** (ej. `control-pagos-v9` → `v10`). Si no se hace, los navegadores/PWA instalados seguirán mostrando la versión vieja indefinidamente, porque el Service Worker usa estrategia *cache-first* y solo revisa si hay una versión nueva cuando detecta que el archivo `sw.js` cambió de bytes.
El flujo de auto-actualización ya está implementado en `index.html` (registro del SW + `reg.update()` + recarga automática al detectar `controllerchange`), así que con solo subir la versión en `sw.js`, la próxima vez que el usuario abra la app se actualizará sola.

## Flujo de guardado / protección de versiones
- Existe un **hook de `Stop`** configurado en `.claude/settings.local.json` que, al terminar cada turno de Claude, hace automáticamente `git add -A`, `git commit` (mensaje `Auto: YYYY-MM-DD HH:mm`) y `git push origin main` si hay cambios. Esto mantiene el repositorio de GitHub siempre al día como respaldo.
- Cuando se considera que `index.html` está en un punto **estable**, se copia a `index.stable.html` (comando permitido: `copy index.html index.stable.html`). Ese cambio también queda protegido por el mismo hook de auto-commit/push.
- Es decir: **cada cierre de sesión de trabajo = commit + push automático**. No se requiere acción manual de git para mantener el repo actualizado.

## 🔐 PROPUESTA EN ANÁLISIS: login real + permisos por sección (planteada 2026-09-15)
**Estado: solo análisis, NADA implementado.** El usuario la planteó y dijo que continuamos después. No empezar a construir sin confirmar las decisiones del final de esta sección.

### Qué pidió el usuario
1. Cada sección con usuarios y permisos propios, administrables por los dos admins desde una **sección de Configuración** nueva (asignar correo → sección).
2. **Login**, preferiblemente con Google (o correo/contraseña), con registro de usuarios nuevos (nombre, correo, teléfono).
3. **Reglas de visualización por sección**: quien tenga "Viáticos" no puede ver los pagos de "Registro de pagos", etc.
4. **Unificar los links** — eliminar el `?vista=gastos` y controlar todo con el login.
5. **Separar los datos por hoja y por carpeta de Drive** (ampliado el 2026-09-15): cada sección tiene su propia hoja en el Sheet **y su propia carpeta en Drive** para los archivos adjuntos.

### Modelo de secciones (sección = tipo de pago = hoja = carpeta = permiso)
| Sección | Hoja del Sheet | Carpeta Drive | ¿Existe hoy? |
|---|---|---|---|
| Registro de Pagos (Proveedor, Compra, Venta) | la principal actual | `PJ04 FACTURAS` | ✅ |
| Viáticos | `Viaticos` | `PJ04 VIATICOS` | tipo sí, hoja/carpeta no |
| Caja Menor | `Caja Menor` | `PJ04 CAJA MENOR` | tipo sí, hoja/carpeta no |
| Pago Impuestos | `Pago Impuestos` | `PJ04 IMPUESTOS` | tipo sí, hoja/carpeta no |
| **Seguridad Social** | `Seguridad Social` | `PJ04 SEGURIDAD SOCIAL` | ❌ **tipo de pago NUEVO** |
| **Pago Nómina** | `Pago Nomina` | `PJ04 NOMINA` | ❌ **tipo de pago NUEVO** |
| Aprobaciones | `SOLICITUDES DE APROBACION` | ¿carpeta propia? (pendiente) | hoja sí |

**Ojo:** "Seguridad Social" y "Pago Nómina" **no existen como tipo de pago**. Hay que crearlos completos igual que se hizo con Viáticos/Caja Menor: botón en el selector con ícono, `data-value`, badge de color, opción en el filtro de "Tipo de pago", y CSS `.tipo-btn.active[data-value="..."]` (este último se olvidó la vez pasada y el usuario reportó que "no se selecciona de ningún color").

Efecto secundario bueno: un usuario restringido lee **una sola hoja**, así que su consulta será más rápida que hoy. Los admins leen todas.

### ⚠️ Esto ROMPE los reportes diario/mensual
`leerDatos_()` en `apps-script.gs` usa `SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]` — **solo la primera hoja**. Apenas se separen los datos, los reportes seguirán llegando pero **sin Viáticos, Caja Menor, Impuestos, Nómina ni Seguridad Social, y sin ningún aviso de que están incompletos**. Hay que decidir si el reporte consolida todas las hojas o si se manda uno por sección. **No olvidar esto al implementar la fase 1.**

### El punto crítico del análisis
**Un login en el frontend NO da seguridad si los endpoints siguen abiertos.** Hoy el webhook de consulta de n8n devuelve todos los pagos a cualquiera que sepa la URL, y el Apps Script está desplegado como "Anyone". Poner una pantalla de login encima sería el mismo teatro que ya tenemos con `?vista=gastos`. Para que la restricción sea real, **el servidor debe identificar al que llama y devolver solo lo que le corresponde**.

### Arquitectura recomendada
- **Google Sign-In (Google Identity Services)** en el frontend → se obtiene un **ID token (JWT)** → se manda en cada petición → **Apps Script lo verifica contra Google** (`https://oauth2.googleapis.com/tokeninfo?id_token=...`, validando `aud` = nuestro Client ID y `email_verified`) y extrae el correo verificado. Ese correo no se puede falsificar desde el cliente.
  - Se descarta usuario/contraseña propio: implicaría guardar y hashear contraseñas, recuperación, etc. Riesgo innecesario cuando Google lo resuelve.
  - Se descarta desplegar el Web App como "Execute as: User accessing" (que daría `Session.getActiveUser()`): **no funciona con `fetch` desde otro origen** (GitHub Pages). Solo funcionaría si la app entera se sirviera desde Apps Script con HtmlService, lo que cambiaría la URL y rompería la PWA actual.
- **Hoja "USUARIOS"**: `CORREO · NOMBRE · TELEFONO · ROL (admin|usuario) · SECCIONES (lista: pagos, viaticos, caja_menor, aprobaciones) · ESTADO (pendiente|activo|inactivo) · FECHA REGISTRO`.
- **Flujo de alta**: usuario entra → login Google → el backend no lo encuentra → lo crea como `pendiente` pidiéndole nombre y teléfono → no ve nada hasta que un admin lo active y le asigne secciones desde Configuración. Resuelve registro y control de acceso en un solo flujo, sin auto-asignación de permisos.
- **Permisos por hoja**: al separar Viáticos y Caja Menor en hojas propias, el permiso se vuelve "qué hoja puede leer el servidor para ti" — mucho más robusto que filtrar filas, y encaja con el punto 5 del usuario.

### Consecuencia grande: obliga a salir de n8n del todo
El filtrado por permisos tiene que ocurrir donde se validó el token (Apps Script). Eso implica **migrar "Nuevo Pago" (escritura + archivo) y "Consultar Pagos" (lectura) de n8n a Apps Script**. Va en la dirección que el usuario ya quería, pero **es una reescritura grande, no un agregado**.

### Costos honestos que ya se le comunicaron
1. **Los envíos se vuelven más lentos**: "Nuevo Pago" pasaría de n8n (~3-5s) a Apps Script (~15-30s con archivo) — justo la lentitud que le molestó en Aprobaciones. Mitigable, no eliminable.
2. **Todos necesitan cuenta de Google.**
3. **Hacerlo por fases**, el sistema está en producción con pagos reales.

### Fases propuestas
1. Hojas "Viaticos" y "Caja Menor" + migrar escritura/lectura a Apps Script.
2. Login Google + hoja USUARIOS + registro en estado pendiente.
3. Sección "Configuración" para administrar usuarios.
4. Aplicar reglas por sección en el servidor y eliminar `?vista=gastos`.

### Decisiones pendientes de confirmar con el usuario
**Sobre el login y los permisos:**
- ¿Google Sign-In (recomendado) o correo/contraseña?
- ¿Acepta migrar todo fuera de n8n y la lentitud que implica en "Nuevo Pago"?
- ¿Un usuario puede tener varias secciones a la vez? ¿Los admins ven todo siempre?
- ¿Qué pasa con los pagos que registre un usuario de Viáticos — solo ve los suyos o todos los de su sección?

**Sobre la separación en hojas/carpetas:**
- ¿"Pago a Proveedor", "Compra" y "Venta" quedan juntos en la hoja principal como una sola sección ("Registro de Pagos"), o cada uno también va aparte? (El usuario solo pidió 5 hojas nuevas, lo que sugiere que quedan juntos — confirmar.)
- Los registros de Viáticos/Caja Menor/Impuestos que **ya existen** en la hoja principal: ¿se migran a las hojas nuevas o el histórico se queda donde está y solo lo nuevo va separado?
- **Reportes diario/mensual**: ¿consolidan todas las hojas, o se manda un reporte por sección a los responsables de cada una?
- **Aprobaciones**: ¿carpeta propia en Drive? ¿Un usuario de Viáticos solo puede solicitar aprobaciones de tipo Viáticos, o de cualquier tipo? (Hoy el módulo permite cualquier tipo a cualquiera, por decisión explícita del usuario.)

## ⚡ Rendimiento de Aprobaciones — por qué se siente lento (2026-09-15)
**Apps Script es inherentemente lento para este caso.** Un `solicitar_aprobacion` hace, de forma síncrona antes de responder: decodificar base64 → crear archivo en Drive → `setSharing` (llamada extra a la API de Drive, ~1-3s por archivo) → `appendRow` en el Sheet → enviar correo HTML. Fácilmente 15-30 segundos. Un `consultar_solicitudes` arranca en frío en ~2-4s.

El usuario reportó que al enviar aparecía **"No se pudo conectar con el sistema" pero la solicitud SÍ se guardaba y el correo SÍ llegaba**. Se descartó CORS empíricamente con `curl`: el 302 y la respuesta final de `script.googleusercontent.com` traen `Access-Control-Allow-Origin: *` y JSON válido. Era puramente el tiempo: el navegador abandonaba la lectura de la respuesta después de que el servidor ya había hecho el trabajo.

**Mitigaciones aplicadas (no eliminan la latencia de fondo, la hacen invisible):**
- **Servidor:** un solo `MailApp.sendEmail` con los dos admins en `to` en vez de un envío por persona.
- **Verificación en vez de mentir:** si el POST de la solicitud falla, el frontend consulta el servidor buscando el `ID SOLICITUD` que acaba de generar (`solicitudExiste()`); si está, muestra éxito. Así un falso error de red no le miente al usuario.
- **Timeout explícito** de 120s con `AbortController` en `postAppsScript()`, para que nunca se quede colgado indefinidamente.
- **Caché local de la lista** (`solicitudesCache` en `localStorage`): al abrir "Revisar Solicitudes" se pinta al instante la última lista conocida y el refresco ocurre por detrás. Los filtros por estado (Pendientes/Aprobadas/...) ya no consultan al servidor, filtran sobre los datos en memoria (`pintarSolicitudesFiltradas()`).
- **Actualización optimista** al aprobar/rechazar: la tarjeta cambia de estado de inmediato y el refresco confirma después.

**Si se necesita más velocidad en el futuro:** lo más pesado es el correo dentro del request. Se podría diferir con un trigger `.after()` de Apps Script guardando el payload en `CacheService`, a costa de más complejidad y de que el correo llegue ~1 minuto después.

## ✅ Fase 1 — completa (2026-09-15)
Todo desplegado, migrado y verificado. Hojas actuales del Sheet: `PAGOS REGISTRADOS` (principal), `SOLICITUDES DE APROBACION`, `Seguridad Social`, `Pago Nomina`, `Pago Impuestos`, `Caja Menor`, `Viaticos`.

### Cómo trabajar con el Apps Script (para sesiones futuras)
- El proyecto de Apps Script está **bound al Sheet** y se llama "Untitled project" (nunca se le puso nombre). Se llega por `Extensions → Apps Script`.
- Tras pegar código nuevo hay que **guardar (Ctrl+S)** para que el desplegable de funciones se actualice — si no, sigue mostrando la lista de la última versión guardada.
- Las funciones que terminan en `_` son privadas por convención de Apps Script y **no aparecen** en ese desplegable. Es esperado.
- Para que un cambio llegue al Web App: `Deploy → Manage deployments → ✏️ → Version: "New version" → Deploy`. **Nunca "New deployment"**: genera otra URL y obliga a cambiar `APPS_SCRIPT_URL` en `index.html`.
- **Después de cada despliegue, probar el endpoint real con `curl`** (con `-H "User-Agent: Mozilla/5.0 ..."`). `node --check` sobre `apps-script.gs` valida sintaxis pero no errores de ejecución — así se detectó el `ReferenceError` de la zona muerta temporal.

### Si hay que volver a migrar (al agregar otra sección, por ejemplo)
1. `simularMigracion()` — solo lectura, dice qué se movería. **Siempre primero.**
2. Revisar que los totales cierren y que diga "Encabezados de las hojas destino: OK".
3. `migrarPagosAHojasPorSeccion()` — hace respaldo del Sheet en Drive antes de tocar nada.
4. Conciliar contra `?action=consultar_pagos`: misma cantidad de registros y misma suma de `VALOR FACTURA`, **descontando los registros de prueba**.

## 🗂️ Una hoja y una carpeta por sección
Definido en `SECCIONES` dentro de [apps-script.gs](apps-script.gs). `hojaDeSeccion_()` crea la hoja si no existe (copiando los encabezados de la principal) y `carpetaDeSeccion_()` hace lo mismo con la carpeta de Drive.

| Sección | Tipos que agrupa | Hoja del Sheet | Carpeta de Drive |
|---|---|---|---|
| `pagos` | Pago a Proveedor, Compra, Venta | hoja principal (índice 0) | `PJ04 FACTURAS` |
| `viaticos` | Viáticos | `Viaticos` | `PJ04 VIATICOS` |
| `caja_menor` | Caja Menor | `Caja Menor` | `PJ04 CAJA MENOR` |
| `impuestos` | Pago Impuestos | `Pago Impuestos` | `PJ04 IMPUESTOS` |
| `seguridad_social` | Seguridad Social *(nuevo)* | `Seguridad Social` | `PJ04 SEGURIDAD SOCIAL` |
| `nomina` | Pago Nómina *(nuevo)* | `Pago Nomina` | `PJ04 NOMINA` |

**Los reportes diarios/mensuales consolidan todas las hojas en uno solo.** `leerDatos_()` se reescribió para recorrer `hojasDePagos_()` en vez de solo `getSheets()[0]` — sin ese cambio los reportes habrían quedado incompletos en silencio apenas se migraran los datos. `HOJAS_NO_PAGOS` (`SOLICITUDES`, `USUARIOS`) excluye las hojas que no son de pagos.

Aprobaciones **no** tiene carpeta propia a propósito: es un visto bueno visual temporal, no un registro contable.

## 🌐 PENDIENTE: mudar a `pagos.energy-millennium.com`
Decidido con el usuario el 2026-09-16. **Bloqueado**: no tiene acceso al panel de Wix en este momento. Retomar cuando lo tenga.

**Por qué ese dominio:** `energy-millennium.com` ya es de la empresa, así que no hay que comprar nada. El DNS está en **Wix** (`ns4/ns5.wixdns.net`). Se descartó EasyPanel (el resultado no sería más profesional que github.io y suma un servidor que mantener para un sitio estático) y la organización de GitHub (sigue diciendo "github.io").

**Ya hecho (2026-09-16):** la app **dejó de depender de la ruta** `/PJ04-CONTROL-PAGOS/`. `sw.js`, `manifest.json` y el registro del Service Worker usan rutas relativas, así que funciona igual en la dirección actual que en la nueva. Sin esto, mudarla exigía que el DNS y el despliegue ocurrieran en el mismo instante y cualquier desfase dejaba el sistema caído.

**Pasos que faltan, en este orden:**
1. **Wix** → Dominios → energy-millennium.com → Editar registros DNS → agregar **CNAME**: host `pagos`, apunta a `ashir7ai-star.github.io` (sin `https://` y sin la ruta).
2. Verificar que resuelva (`nslookup pagos.energy-millennium.com`). Puede tardar horas.
3. **Google Cloud Console** → Clients → cliente OAuth → *Authorized JavaScript origins*: agregar `https://pagos.energy-millennium.com`. **Dejar también el origen viejo** durante la transición, o el login se cae.
4. Recién entonces: archivo `CNAME` en la raíz del repo con `pagos.energy-millennium.com` (o GitHub → Settings → Pages → Custom domain, que además provisiona el certificado HTTPS).
5. Actualizar `URL_APP` en [apps-script.gs](apps-script.gs) (hoy apunta a la dirección vieja; solo se usa en los enlaces de los correos) y redesplegar.

⚠️ **Las PWA ya instaladas habrá que reinstalarlas**: una PWA queda atada a la dirección donde se instaló. La vieja seguirá andando por redirección, pero conviene reinstalar desde la nueva.

## 📁 Carpetas de Drive: se pueden mover, NO renombrar
**Estado al 2026-09-16:** las siete carpetas `PJ04 …` se agruparon dentro de `FACTURAS CONTROL DE PAGOS`. La carpeta vieja `FACTURAS` (de la época de n8n) se vació —sus archivos se movieron a `PJ04 FACTURAS`— y se eliminó. **Verificado con `revisarCarpetaAntesDeBorrar()`: 99 enlaces revisados, 0 rotos.** Mover archivos en Drive no cambia su identificador, así que los enlaces del Sheet sobrevivieron intactos.


`carpetaDeSeccion_()` busca la carpeta **por nombre en todo el Drive** (`DriveApp.getFoldersByName`), sin importar dónde esté. Consecuencias:
- ✅ **Mover las carpetas a una carpeta madre es seguro.** El script las sigue encontrando y los archivos ya subidos no se tocan (los enlaces del Sheet apuntan al ID del archivo, no a su ubicación).
- ❌ **Renombrarlas rompe el sistema en silencio**: el script no encuentra la carpeta vieja, **crea una nueva con el nombre original** y los archivos nuevos empiezan a caer ahí, dispersos. Si hay que renombrar, cambiar también `SECCIONES` en [apps-script.gs](apps-script.gs) y redesplegar.
- ⚠️ **No duplicar nombres.** Si existieran dos carpetas llamadas igual, `getFoldersByName` toma la primera que encuentre y no hay garantía de cuál es.
- Ojo: en la tabla de secciones "PJ04 FACTURAS" aparece tres veces porque **tres tipos de pago** (Proveedor, Compra, Venta) comparten la sección `pagos`. Es una sola carpeta, no tres.

## 💰 Saldos disponibles (2026-09-16)
Cuatro bolsas de dinero: **Banco Millennium**, **Banco AMPAC**, **Caja Menor** y **Viáticos** (estas dos últimas compartidas entre las dos empresas, por decisión del usuario).

### La decisión de diseño que hace que cuadre
**El saldo NO se guarda como un número que se pisa con cada pago. Se CALCULA:**

```
saldo = saldo base que cargó un admin − pagos registrados DESPUÉS de esa base
```

Guardar un número y restarle cada pago parece más simple, pero se rompe de dos formas inaceptables cuando hay dinero de por medio:
1. **Condición de carrera**: dos personas registrando un pago a la vez leen el mismo saldo y una pisa a la otra — un pago desaparece del saldo.
2. **Reintentos**: un reintento de red (exactamente lo que provocaba el Service Worker viejo) descuenta **dos veces** el mismo pago, en silencio.

Calculándolo, el saldo siempre coincide con las filas que están en las hojas: no se puede descontar dos veces, no hay carrera, y si alguien corrige el valor de un pago viejo el saldo se corrige solo. El precio es leer las hojas de pagos para responder — lo mismo que ya hace "Consultar Pagos".

### Reglas
| Tipo de pago | De dónde descuenta |
|---|---|
| Pago a Proveedor, Compra, Impuestos, Seguridad Social, Nómina | Banco de la **empresa** del registro |
| Viáticos | Fondo de Viáticos (compartido) |
| Caja Menor | Fondo de Caja Menor (compartido) |
| **Venta** | **Ninguno** — es dinero que entra (decisión del usuario) |
| Empresa no reconocida | Ninguno — **no se adivina**; se reporta aparte en el panel |

- Los pagos **anteriores o del mismo minuto** que la base **no se descuentan**: el saldo que carga el admin ya los refleja, volver a restarlos sería contarlos dos veces.
- La hoja `SALDOS` es **historial**: cada ajuste es una fila nueva, nunca se pisa una anterior. Vale la última de cada cuenta.
- `SALDOS` está en `hojasNoPagos_()` — si no, se contaría a sí misma como pagos.
- Solo **administradores** pueden cargar o corregir un saldo (validado en el servidor, no solo ocultando el botón).
- **Banco de pruebas: [prueba-saldos.js](prueba-saldos.js)** — 35 comprobaciones de la lógica de dinero contra hojas simuladas. Correr con `node prueba-saldos.js apps-script.gs`. **Re-correrlo ante cualquier cambio en el bloque E.**

## ➕ Cómo agregar un tipo de pago / sección nueva
Toca **ocho** lugares. Olvidar uno da fallos sutiles y silenciosos — ya pasó dos veces (el CSS de selección, y `tipoInfo()` etiquetando como "Venta"). **[prueba-consulta.js](prueba-consulta.js) verifica los ocho automáticamente**, así que basta correrlo: `node prueba-consulta.js`.

En [apps-script.gs](apps-script.gs):
1. `SECCIONES` — la clave, el nombre de la hoja y el de la carpeta de Drive (ambas se crean solas al primer registro).
2. `etiquetaTipo_()` — para los correos. **Los casos exactos van primero**: `'compra_materiales'` contiene `'compra'`, así que el genérico lo capturaría antes.

En [index.html](index.html):
3. Botón en `#tipoSelector` **y** en `#tipoSelectorSolicitud` (los dos).
4. CSS `.tipo-btn.active[data-value="..."]` — **sin esto el botón no se marca al tocarlo** y parece que no respondiera.
5. `<option>` en el filtro `#fTipo`.
6. `tipoInfo()` — **devuelve "Venta" por defecto**, así que un tipo sin caso propio se etiqueta mal en silencio. Los exactos, primero.
7. `seccionDeTipoFront()`.
8. `ETIQUETA_SECCION` (para el selector de secciones de Configuración) y el arreglo `secciones` por defecto de `sesion`.

¿Necesita saldo propio? Solo si es una bolsa de dinero aparte. Si no, `cuentaDePago_()` lo manda al banco de la empresa automáticamente.

## 🔁 Traslados entre cuentas propias (2026-09-16)
Enviar dinero del banco al fondo de viáticos **NO es un gasto**: la plata no sale de la empresa, cambia de bolsillo. El gasto ocurre después, cuando quien está en campo lo usa y carga su recibo.

⚠️ **Si un traslado se registrara como un pago, el reporte contaría DOS VECES el mismo dinero** — una al enviarlo y otra al gastarlo. Por eso `TRASLADOS` está en `hojasNoPagos_()` y hay una prueba que lo vigila.

| Aspecto | Cómo quedó |
|---|---|
| Hoja | `TRASLADOS` (fecha, origen, destino, monto, quién, nota, comprobante) |
| Carpeta | `PJ04 TRASLADOS` |
| Efecto en saldos | **resta** del origen, **suma** al destino |
| Quién puede | **solo administradores** (validado en el servidor) |
| Movimientos | **banco → fondo** únicamente; se rechaza banco→banco, fondo→banco y origen=destino |
| Comprobante | **obligatorio** |

La **regla de corte por fecha se aplica por separado a cada lado**: cada cuenta tiene su propio saldo base, así que un traslado se descuenta del origen solo si es posterior a la base *del origen*, y se suma al destino solo si es posterior a la base *del destino*.

## Historial de cambios recientes
- **2026-09-16**: 🔴 **"Guardar usuario no hace nada" — el error se dibujaba detrás del modal.** Reportado en la PWA (en la web funcionaba).
  - **Causa:** el orden de capas estaba invertido. `.toast` tenía `z-index: 999` y `.modal-fondo` **9500**, así que **todo mensaje de error quedaba tapado por el modal**. Peor: `.login-overlay` estaba en 9000, también por debajo — o sea que si la sesión vencía, la app pedía iniciar sesión **detrás** del formulario abierto. Desde el lado del usuario, apretar Guardar no producía nada.
  - **Orden correcto, ahora fijado:** encabezado/menú 100 · calendario 1000 · **modales 9000** · **pantalla de acceso 9500** (bloquea todo lo demás) · **mensajes 10000** (siempre visibles).
  - `mostrarLogin()` además **cierra los modales abiertos**: pedir sesión con un formulario flotando confunde, y se seguiría escribiendo en algo que ya no se puede guardar.
  - ⚠️ **Un z-index mal puesto no da ningún error**: el elemento queda tapado y el síntoma es "el botón no funciona". Hay 5 comprobaciones en [prueba-frontend.js](prueba-frontend.js) que vigilan el orden, verificadas reintroduciendo el bug. `sw.js` → `control-pagos-v62`.

- **2026-09-16**: 🐛 **Zona de carga de Traslados con un ícono gigante.** Escribí `.upload-icon`, `.upload-text` y `.upload-hint`, pero las clases reales son **`.upload-icon-wrap`**, **`.upload-title`** y **`.upload-sub`**. Una clase inexistente **no da ningún error**: el elemento simplemente queda sin estilo, y el SVG creció hasta ocupar media pantalla.
  - **Estructura correcta de una zona de carga** (copiar de `#uploadZone`): el `<input type="file">` va **dentro** de `.upload-zone`, seguido de `.upload-icon-wrap` > `svg`, `.upload-title` y `.upload-sub`.
  - ⚠️ **Es la segunda vez que inventé una clase** (la primera fue `.btn-secundario`). Ahora [prueba-frontend.js](prueba-frontend.js) **verifica que toda clase usada en el HTML exista en el CSS**. Verificada reintroduciendo el error exacto: lo detecta. `sw.js` → `control-pagos-v61`.

- **2026-09-16**: 🔁 **Sección "Traslados"** — registrar envíos de dinero del banco a los fondos de Viáticos/Caja Menor. Ver la sección "🔁 Traslados" arriba. **12 comprobantes nuevos** en [prueba-saldos.js](prueba-saldos.js), incluida una que verifica que **el total del sistema solo baje por el gasto real** (la plata no se duplica ni se evapora al moverse). Verificadas invirtiendo el signo del traslado y sacando `TRASLADOS` de las hojas excluidas: detectan ambas. `sw.js` → `control-pagos-v60`.

- **2026-09-16**: 🔒 **Aprobaciones: el correo sale de la sesión y cada quien ve solo sus solicitudes.**
  - **Se eliminó el campo "Correo"** del formulario de solicitud: el sistema ya sabe con qué cuenta entraste. Ahora `crearSolicitud_()` lo toma de `ctx.correo` (la sesión verificada contra Google). No es solo comodidad: **es lo que hace confiable el filtro de privacidad**, porque si el correo fuera un campo libre, cualquiera podría escribir el de otro y ver —o generar— solicitudes ajenas.
  - **"Revisar Solicitudes" ahora filtra por persona**: un usuario común ve **únicamente las suyas**; los administradores ven todas, porque son quienes aprueban. **Filtrado en el servidor**, no en la pantalla: las solicitudes de otros —con sus proveedores, montos y correos— ya no viajan al navegador.
  - "Solicitado por" y "Registrado por" se **precargan** con el nombre de la sesión, pero quedan editables (alguien puede registrar en nombre de otro).
  - **El banco de pruebas ahora puede simular sesiones reales**: el stub de `UrlFetchApp` responde como Google, usando el correo como "token". Sin eso no se podía probar nada en modo `'estricto'`. Se agregaron 7 comprobaciones de privacidad, verificadas quitando el filtro y devolviendo el correo al formulario: **detectan ambas regresiones**. `sw.js` → `control-pagos-v58`.

- **2026-09-16**: 🔧 **Despliegue nuevo del Apps Script — `APPS_SCRIPT_URL` cambió.** El despliegue anterior (`AKfycbyDHauDZG…`) **dejó de tomar el código nuevo**: `verificarVersion()` en el editor mostraba las 7 secciones, pero el Web App seguía sirviendo una versión vieja incluso eligiendo "New version" y tras sondear 2 minutos. Se creó un despliegue nuevo (`AKfycbxDRCP3efj…`, Version 17) y se verificó que responde las 7 secciones.
  - **Nuevo diagnóstico disponible: `verificarVersion()`** — se corre desde el editor y muestra qué código está **guardado**, independientemente del despliegue. Separa dos problemas que desde afuera se ven idénticos: "pegué una copia vieja" vs. "el despliegue apunta a una versión anterior". Fue lo que permitió descartar el primero.
  - ⚠️ **Si un despliegue deja de actualizarse, no insistir:** crear uno nuevo (`Deploy → New deployment`) y cambiar `APPS_SCRIPT_URL` en `index.html`. Es un cambio de una línea y evita perder intentos.
  - 📌 **Apps Script devuelve 404 transitorios con frecuencia** en `script.googleusercontent.com/macros/echo` (se observó ~50% en una tanda de 10). Se resuelven reintentando; las **lecturas** ya reintentan solas. Las escrituras **no** reintentan a propósito, para no duplicar un pago.

- **2026-09-16**: 🔴 **Un tipo de pago que el servidor no conoce ya NO se archiva en silencio.** Un pago de "Compra Materiales" quedó registrado en la hoja principal y en `PJ04 FACTURAS` en vez de crear su hoja y su carpeta.
  - **Causa:** el Apps Script desplegado era **anterior** al cambio que agregó la sección. `seccionDeTipo_()` devuelve `'pagos'` ante cualquier tipo desconocido — un valor por defecto correcto para Proveedor/Compra/Venta, pero que ante un tipo nuevo **archivaba el pago donde no correspondía, sin avisar**. Ese es el peor tipo de error en datos contables: nada falla visiblemente.
  - **Fix:** `tipoConocido_()` + validación en `registrarPago_()` **antes de escribir nada**. Si el servidor no conoce el tipo, devuelve un error que dice explícitamente que hay que redesplegar, y no registra nada.
  - **Cómo verificar qué versión está desplegada:** `curl` a `?action=estado_login` → el campo `secciones` lista las que conoce el servidor. Si falta ese campo, el script es anterior a 2026-09-16.
  - ⚠️ **La app y el Apps Script se despliegan por separado.** Un desfase entre ambos produce fallos confusos; ante cualquier síntoma raro, comparar primero las secciones que informa `estado_login` contra las que tiene la app.
  - 📌 **Nota sobre Apps Script:** se observó un **404 transitorio** en `script.googleusercontent.com/macros/echo` (la URL con la que Google entrega las respuestas). Se resolvió solo al reintentar. Es la misma familia de fallos que producía `Unexpected token '<'`; el reintento automático para lecturas ya lo cubre. `sw.js` → `control-pagos-v56`.

- **2026-09-16**: 🔑 **Arranque instantáneo y renovación silenciosa de la sesión.** Reportado: ~30s de pantalla en blanco sin siquiera el botón de Google, y la sesión "venciéndose" sola pese a ser un dispositivo ya registrado.
  - **Los 30 segundos:** `arrancarSesion()` **esperaba** la respuesta de `estado_login` (timeout 25s) antes de mostrar nada. Con Apps Script frío eso bloqueaba todo. Ahora el arranque **no toca la red**: usa el último modo conocido de inmediato y `refrescarModoEnSegundoPlano()` lo confirma por detrás; si cambió, se aplica.
  - **La sesión que "vencía":** el token de Google dura ~1 hora y **no se puede alargar** — pero **token vencido ≠ sesión cerrada**. Tratarlos como equivalentes era el error. Ahora, con el token vencido: (a) el perfil y los permisos **se restauran igual**, (b) se pide un token nuevo a Google **en silencio** (`auto_select` + `login_hint`, que funciona mientras la persona siga con sesión en el navegador), (c) solo si eso falla se le pide entrar.
  - **Renovación anticipada:** `programarRenovacion()` renueva **5 minutos antes** de que el token caduque, así nunca caduca mientras alguien está trabajando.
  - **Un `SESION_INVALIDA` ya no expulsa** a quien venía usando el sistema: primero se intenta la renovación silenciosa. Eso era lo que la cerraba "sola" cada tanto.
  - Mientras carga la librería de Google, el botón muestra "Conectando con Google…" en vez de un hueco vacío que parecía colgado.
  - ⚠️ **Principio:** nada de lo que decide el arranque debe depender de que el servidor conteste rápido. Apps Script es lento y a veces falla; la app tiene que abrir igual. `sw.js` → `control-pagos-v54`.

- **2026-09-16**: 🔴 **Causa raíz de "desplegué pero no veo los cambios".** El usuario no veía la sección nueva pese a que GitHub Pages ya la servía (verificado con `curl`).
  - **El defecto:** GitHub Pages manda `Cache-Control: max-age=600` en `index.html` y `sw.js`. Cuando el Service Worker nuevo se instalaba, su `c.add()` **pasaba por la caché HTTP del navegador**, así que podía guardar en la caché NUEVA una copia VIEJA de `index.html`. **La versión subía pero el contenido no**, y todo parecía correcto: por eso costó tanto verlo.
  - **Tres correcciones:** (a) `c.add(new Request(u, { cache: 'reload' }))` fuerza bajar de la red, salteando la caché HTTP. (b) `registrarServiceWorker` con `updateViaCache: 'none'`, para que el propio `sw.js` no tarde hasta 10 minutos en detectarse. (c) **El documento HTML pasa a red-primero con caché de respaldo**: el resto de los archivos (fuentes, CDN) casi nunca cambian y conviene servirlos de caché, pero `index.html` es lo único que cambia en cada actualización. Sigue abriendo sin conexión.
  - ⚠️ **Al diagnosticar "no veo los cambios", verificar SIEMPRE primero qué está sirviendo el servidor** (`curl` a la URL pública), antes de tocar nada. Aquí el despliegue estaba perfecto y el problema era del lado del cliente. `sw.js` → `control-pagos-v53`.

- **2026-09-16**: ➕ **Sección nueva: "Compra Materiales"** (hoja `Compra Materiales`, carpeta `PJ04 COMPRA MATERIALES`, color índigo `#4f46e5`). Descuenta del banco de la empresa del registro, como los demás tipos que no son fondos.
  - De paso se corrigió `etiquetaTipo_()`: **Seguridad Social y Pago Nómina salían con el valor crudo en los correos** (`seguridad_social`, `nomina`) porque nunca se les agregó su caso. Se reordenó para que los exactos vayan primero.
  - **Nuevo control en [prueba-consulta.js](prueba-consulta.js):** verifica que **cada** sección del backend esté dada de alta en los ocho lugares, **ejecutando** `tipoInfo()` y `etiquetaTipo_()` en vez de buscar texto (la primera versión daba falsos negativos porque el código usa prefijos como `'viatic'` e `'impuesto'`). También comprueba que la etiqueta **coincida** entre la app y los correos. Verificado quitando el CSS y el caso de `tipoInfo`: detecta ambos.
  - Las pruebas de permisos tenían el número de secciones **escrito a mano** y se rompieron al agregar la séptima. Ahora lo leen del backend, así que una sección nueva no rompe pruebas ajenas. (Detalle: `SECCIONES` es `const` y los `const` no quedan expuestos en el contexto de la VM; hay que evaluarlos dentro.) `sw.js` → `control-pagos-v52`.

- **2026-09-16**: 🔍 **Consulta de pagos: diagnóstico claro, auto-reparación del Service Worker y verificación de extremo a extremo.** El usuario reportó `Unexpected token '<', "<!DOCTYPE"... is not valid JSON` al consultar.
  - **Qué significa ese error:** el servidor devolvió **HTML en vez de JSON**. Verificado con `curl` que el backend desplegado responde JSON correcto, así que el HTML se genera **en el navegador del cliente** — casi siempre por un **Service Worker viejo atascado** que rompe la redirección con la que Apps Script entrega las respuestas.
  - **Auto-reparación:** un SW roto **no puede corregirse solo**, porque es él mismo quien sirve la app; se queda indefinidamente y el usuario no tiene forma de saberlo. Ahora la página le pregunta su versión por `MessageChannel`; las anteriores a la v51 **no contestan**, y ese silencio basta para detectarlas: se desregistran y se recarga. Protegido contra bucles con `sessionStorage`.
  - **Errores accionables:** `postAppsScript` lee la respuesta como texto y la parsea a mano. Si no es JSON, `describirRespuestaNoJson()` distingue entre una pantalla de cuenta de Google, un error de ejecución del servidor y una redirección perdida, en vez del inútil "Unexpected token '<'".
  - **Reintento seguro:** un solo reintento, y **solo para acciones de lectura** (`ACCIONES_DE_LECTURA`). Reintentar una escritura podría **registrar el mismo pago dos veces** — inaceptable con datos bancarios.
  - **Banco de pruebas nuevo: [prueba-consulta.js](prueba-consulta.js)** — verifica las DOS mitades de la consulta: qué hojas entrega el servidor según los permisos, y cómo filtra después el navegador (extrayendo `filtrarRows` real de `index.html` y ejecutándolo con un DOM simulado). Incluye el caso exacto reportado: AMPAC + Viáticos. `sw.js` → `control-pagos-v51`.

- **2026-09-16**: 🔴 **Fix: "Consultar Pagos" no devolvía nada con el acceso restringido.** Reportado: un usuario con Viáticos y Caja Menor consultaba y no aparecía ningún pago.
  - **Causa:** `buscarPagos()` seguía pidiendo los datos por **GET** (`?action=consultar_pagos`). El token se adjunta **solo dentro de `postAppsScript`**, así que esa petición viajaba sin sesión y, con `MODO_LOGIN` en `'estricto'`, el servidor la rechazaba. **No tenía nada que ver con la migración de hojas**: el filtrado por hoja ya funcionaba bien (verificado: un usuario de Viáticos+Caja Menor recibe los pagos de sus dos hojas y ninguno de la principal; un admin recibe los de todas).
  - **Fix:** pasa a POST vía `postAppsScript`. Auditadas todas las llamadas al backend: la única que queda por GET es `estado_login`, que es pública a propósito y no revela datos.
  - ⚠️ **Regla:** **toda** llamada al backend debe pasar por `postAppsScript`, que es el único lugar donde se adjunta el token. Un `fetch(APPS_SCRIPT_URL + '?action=…')` armado a mano viaja sin sesión y falla en modo estricto. Hay dos comprobaciones en [prueba-frontend.js](prueba-frontend.js) que lo vigilan, verificadas reintroduciendo el error. `sw.js` → `control-pagos-v50`.

- **2026-09-16**: 🔒 **Fix de privacidad: los saldos se veían todos, sin importar el rol.** Reportado por el usuario: un usuario **no administrador** veía los saldos bancarios de Millennium y AMPAC.
  - **Regla correcta (definida por el usuario):** los saldos **bancarios son solo para administradores**. Un usuario común ve únicamente los fondos (**Viáticos** y **Caja Menor**) y **solo aquellos cuya sección tenga asignada** — si solo tiene Viáticos, ve solo Viáticos. Un no-admin con la sección `pagos` **no** ve ningún saldo.
  - **Se filtra en el servidor, no en la pantalla.** Ocultarlos en el frontend no habría servido: los montos igual viajaban al navegador de cualquier usuario y se veían en la respuesta de red. También se dejó de informar el conteo global de registros sin asignar a quien no es admin.
  - Si a alguien no le corresponde ninguna cuenta, el panel entero se oculta en vez de quedar vacío.
  - ⚠️ **Sobre las pruebas:** las primeras comprobaciones que escribí para esto **pasaban aunque se quitara el filtro**, porque ninguna sección se llama igual que una cuenta bancaria y ese caso nunca podía darse. Se agregó el caso que sí lo ejercita (pasar un banco como sección, simulando datos malformados o una sección futura con ese nombre) y se verificó que **falla** al quitar el filtro. Una prueba que no puede fallar no prueba nada. `sw.js` → `control-pagos-v48`.

- **2026-09-16**: 🔒 **MODO_LOGIN = `'estricto'`.** Se entra únicamente con cuenta de Google registrada y activa. Antes de activarlo se auditó la hoja `USUARIOS`: 6 usuarios, todos activos, 4 administradores, ninguno sin secciones asignadas.
  - 🔴 **Al auditar aparecieron tres endpoints SIN validación de sesión**, que el modo estricto por sí solo no cerraba. El más grave: **`decidir_solicitud` permitía a cualquiera con la URL aprobar o rechazar pagos**, sin sesión — comprobado con `curl`, respondía "No se encontró la solicitud" en vez de negar el acceso, o sea que ni siquiera la pedía. También estaban abiertos `consultar_solicitudes` (exponía proveedores, montos y correos) y `solicitar_aprobacion`.
  - **Cerrados:** `consultar_solicitudes` y `solicitar_aprobacion` exigen sesión válida; **`decidir_solicitud` exige rol admin**. Además, **"REVISADO POR" ahora sale de la sesión verificada y no de lo que mande el cliente**: antes cualquiera podía firmar una aprobación con el nombre de otro.
  - `consultar_solicitudes` pasó de GET a **POST**, porque el token se adjunta solo en `postAppsScript` y mandarlo en la URL lo dejaría en el historial del navegador y en los registros del servidor.
  - ⚠️ **Lección:** "activar el login" **no** equivale a "el sistema está protegido". `MODO_LOGIN` solo actúa donde alguien llamó a `contextoDe_`. Al agregar una acción nueva al Web App hay que validar la sesión explícitamente; hay un chequeo automático de esto (ver abajo). `sw.js` → `control-pagos-v47`.
  - **Cómo auditar que no quede ninguna abierta:** recorrer las rutas de `doGet`/`doPost` y verificar que la función de cada una llame a `contextoDe_` o `verificarIdToken_`. Las únicas dos legítimamente públicas son `estado_login` (no revela datos) e `iniciar_sesion`/`registrar_usuario` (validan el token por su cuenta).

- **2026-09-16**: 🔴 **Fix: la sesión se perdía al refrescar aunque estuviera guardada.** Reportado con insistencia por el usuario: desaparecían el usuario del encabezado y la pestaña Configuración, y había que volver a entrar.
  - **Causa (error de diseño, no de implementación):** `arrancarSesion()` consultaba `estado_login` **antes** de restaurar la sesión guardada, y si esa consulta fallaba o tardaba más de 8s **asumía `'off'`**. En modo `'off'` la app no pinta la sesión ni muestra Configuración. Apps Script en frío supera los 8s con frecuencia, así que el usuario perdía sesión y permisos **en silencio, sin haber cerrado sesión**. La intención original ("ante un fallo, que la app quede usable en vez de bloquear") era razonable, pero el efecto colateral era mucho peor que el problema que evitaba.
  - **Fix:** se invirtió el orden. **Primero se restaura la sesión guardada, después se consulta la red.** Restaurar primero no debilita nada: esa sesión ya fue validada por el servidor cuando se creó, y toda operación real la vuelve a validar — acá solo decide qué se le muestra a la persona. Además se **recuerda el último modo conocido** (`pj04_modo` en `localStorage`) y se usa si no se puede preguntar, en vez de caer a `'off'`. Timeout de 8s → 25s.
  - **Regla general que sale de esto:** en esta app, *"no pude preguntarle al servidor"* **nunca** debe interpretarse como *"el usuario no tiene sesión"*. Son cosas distintas y confundirlas degrada permisos sin motivo.
  - Verificado simulando los seis escenarios: sesión válida con servidor caído (mantiene sesión y permisos), servidor normal, primera visita sin respuesta, sin sesión con login activo, y los dos cambios de modo desde el servidor (`off` y `estricto`), que sí deben pisar lo recordado. `sw.js` → `control-pagos-v45`.
- **2026-09-16**: 🔑 **La sesión ahora se recuerda.** Reportado: al refrescar se perdía la sesión, desaparecían el usuario del encabezado y los permisos de administrador, y había que volver a entrar. Causa: la sesión vivía **solo en memoria**, y al desactivar la selección automática (2026-09-15) cada recarga exigía entrar de nuevo a mano.
  - **Cómo funciona:** el token y el perfil se guardan en `localStorage` (clave `pj04_sesion`) junto con el vencimiento leído del propio token. Al arrancar, si la sesión guardada sigue válida se restaura **al instante** —sin que se vea la pantalla de login— y la validación contra el servidor corre **en segundo plano** (`revalidarSesion()`), que además refresca los permisos por si un admin los cambió.
  - **La selección automática de Google se reactiva SOLO para quien ya entró antes en ese navegador** (`auto_select` + `login_hint` con el correo recordado). Para alguien nuevo sigue apagada: entrar con la cuenta que el navegador tenga a mano sería un problema en un sistema con permisos por persona, pero renovar la sesión de quien ya venía usando el sistema es otra cosa.
  - **Margen de un minuto**: un token a punto de vencer se descarta, porque llegaría vencido al servidor y el usuario vería un error en vez de la app.
  - **Sin conexión no se expulsa al usuario**: si la revalidación falla por red, la sesión se mantiene. El servidor rechaza igual cualquier operación real si no vale.
  - ⚠️ **Invariante:** limpiar el token en memoria y borrar la sesión guardada van **siempre juntos** (`descartarSesion()`). Separarlos deja una *sesión fantasma*: el token muere pero el guardado sobrevive y la próxima recarga intenta entrar con él. Cerrar sesión y "Entrar con otra cuenta" también borran el recuerdo, si no volverían a entrar solos con la cuenta vieja.
  - El token es una credencial temporal (~1 hora), vive solo en ese navegador y se borra al cerrar sesión. `sw.js` → `control-pagos-v43`.
- **2026-09-16**: 💰 **Saldos disponibles** (bloque E de [apps-script.gs](apps-script.gs) + panel en "Nuevo Pago"). Cuatro cuentas, saldo **calculado** en vez de almacenado (ver sección "💰 Saldos disponibles" arriba para el porqué — es lo que evita descuentos dobles y condiciones de carrera). Solo admins cargan el saldo base; el panel se refresca solo al registrar un pago. Tarjetas con franja de color por tipo de cuenta, cifras en rojo si el saldo queda negativo y números tabulares para poder comparar de un vistazo. Acciones nuevas: `consultar_saldos`, `ajustar_saldo`. **35 comprobaciones** en [prueba-saldos.js](prueba-saldos.js). `sw.js` → `control-pagos-v42`.
- **2026-09-16**: ✅ Login funcionando en web y PWA (confirmado por el usuario). Logo del encabezado **+50%** (36 → 54px), con el encabezado más alto para alojarlo. **`--header-h` es ahora una variable CSS**: el alto del encabezado y el `top` del menú fijo salen de la misma fuente, porque si se separan el menú se superpone o deja un hueco al hacer scroll. Valores: 74px escritorio / 66px celular / 60px angosto, con logo 54/48/44. La prueba dejó de comparar números fijos y ahora verifica el **invariante real** (misma variable + el logo entra en el encabezado en todos los cortes); verificada reintroduciendo los dos defectos. `sw.js` → `control-pagos-v41`.
- **2026-09-15**: 🔴 **Segunda causa raíz: la actualización del Service Worker nunca llegaba al celular.** El fix del SW estaba publicado pero el teléfono seguía fallando mientras la web andaba bien.
  - **Qué pasaba:** el `install` usaba `caches.open(CACHE).then(c => c.addAll(ASSETS))`. **`addAll` es todo-o-nada**: si falla UNO solo de los assets —y hay cinco CDN externos en la lista— la instalación entera falla, el Service Worker nuevo **nunca se activa** y el viejo se queda indefinidamente. En redes móviles inestables pasa seguido y **el usuario deja de recibir actualizaciones sin ningún aviso**. Explica también quejas anteriores de "la PWA no se actualiza".
  - **Fix:** `Promise.allSettled(ASSETS.map(u => c.add(u).catch(() => null)))`. Lo que se pueda cachear se cachea; lo que no, se pide a la red cuando haga falta. La app funciona igual y la instalación **nunca** falla.
  - Además, al registrar se empuja a `SKIP_WAITING` cualquier versión que haya quedado esperando, para que un SW viejo no se quede activo por inercia.
  - **Cómo distinguir los dos fallos:** "No pudimos conectarnos con el sistema" = error de red (Service Worker viejo rompiendo la redirección). "El servidor tardó demasiado" = timeout real. Se separaron a propósito para no volver a confundirlos.
  - **Login:** se quitó `auto_select` (en un sistema con permisos por persona, entrar solo con la cuenta que el navegador tenga a mano es un problema, no una comodidad) y **"Entrar con otra cuenta" ahora siempre está visible** y lleva al selector de cuentas de Google — `disableAutoSelect()` por sí solo NO cambia la cuenta que muestra el botón, solo evita el ingreso automático. `sw.js` → `control-pagos-v40`.
- **2026-09-15**: 🔴 **CAUSA RAÍZ ENCONTRADA: el Service Worker rompía las respuestas del backend.** Síntoma: el login se quedaba "verificando" y devolvía `Acción no reconocida: undefined`.
  - **Qué pasaba:** Apps Script entrega la respuesta de un POST **con una redirección** — ejecuta `doPost` en `/exec` y después manda un 302 a `googleusercontent.com` que el navegador sigue con un GET. El `fetch` del Service Worker interceptaba **todas** las peticiones GET, relanzaba esa con `fetch(e.request)`, se perdía el contexto de la redirección y el navegador terminaba pidiendo `GET /exec` **sin parámetros** → `doGet` sin `action` → "Acción no reconocida: undefined".
  - **Por qué costó verlo:** por `curl` funcionaba perfecto (no hay Service Worker). Solo fallaba en el navegador y en la PWA instalada.
  - **Explica también el misterio viejo de Aprobaciones** ("se demoró mucho, mostró error, pero el correo SÍ llegó y la solicitud SÍ se guardó", 2026-09-15): `doPost` se ejecutaba bien; lo que se rompía era la **entrega de la respuesta**. Las mitigaciones de entonces (verificación post-fallo, caché local) trataban el síntoma; esta es la causa.
  - **Fix:** `sw.js` ignora `script.google.com`, `script.googleusercontent.com`, `accounts.google.com` y `oauth2.googleapis.com`. Son datos vivos: no se cachean nunca. Hay pruebas en [prueba-frontend.js](prueba-frontend.js) que lo vigilan, incluida una que verifica que un dominio parecido (`notscript.google.com.evil.com`) **no** coincida. `sw.js` → `control-pagos-v39`.
  - ⚠️ **Regla para el futuro:** al agregar cualquier backend o servicio externo, sumarlo a `SIN_CACHE` en `sw.js`. Un Service Worker cache-first delante de un backend da fallos intermitentes e imposibles de reproducir fuera del navegador.
- **2026-09-15**: 📱 Encabezado móvil: el nombre de la empresa quedaba cortado. Se corrigió dándole **prioridad a la marca sobre los controles** — "Salir" y el tema pasan a iconos en celular en vez de achicar el logo y el nombre. También: el servidor ahora informa **qué** validación del token falló (`detalle`), el login muestra "Verificando tu acceso…" en vez de parecer que rebota, y el timeout sube de 30s a 90s (Apps Script frío + creación de la hoja `USUARIOS` en el primer inicio).
- **2026-09-15**: 📱 **Diseño adaptable a celular y tablet.** Reportado por el usuario: encabezado apretujado, pestaña "Aprobaciones" cortada y scroll horizontal en la página.
  - **Causa del encabezado:** el logo tenía `style="width:64px;height:64px"` **en línea**, dentro de un `header` de 56px de alto. No se podía adaptar por media query (lo inline gana) y empujaba el nombre de la empresa a tres renglones. Pasó a `.brand-logo` (36px, 30px en celular) y el texto ahora se recorta con elipsis en vez de empujar.
  - **Pestañas:** `.app-nav` ahora se **desliza en horizontal** (`overflow-x:auto` con la barra oculta y scroll-snap). Resuelve cualquier ancho y cualquier cantidad de pestañas, sin rediseñar cuando se agregue una nueva.
  - ⚠️ **`overflow-x: hidden` en `html/body` NO se puede usar acá**: convierte al elemento en contenedor de scroll y **rompe el `position: sticky`** del encabezado y del menú, que el usuario pidió expresamente que quedaran fijos al hacer scroll. Se usa **`overflow-x: clip`**, que recorta sin crear contenedor de scroll. Hay una prueba automática que lo vigila.
  - Cortes: 900px (tablet), 640px (celular: oculta el texto del botón de tema, achica títulos y tarjetas), 400px (angosto: un tipo de pago por fila, botones de filtro a ancho completo, oculta el subtítulo de marca), y uno para pantallas bajas en horizontal, donde los elementos fijos se comían la pantalla.
  - **[prueba-frontend.js](prueba-frontend.js) ampliado** con 9 comprobaciones de diseño adaptable: que sticky siga vivo, que las pestañas se deslicen, que el logo entre en el encabezado, que no haya anchos fijos en línea, y que existan las reglas por tamaño. Verificado reintroduciendo cada defecto a propósito. Ojo: hubo que **quitar los comentarios del CSS antes de analizarlo**, porque un comentario que menciona una propiedad se confundía con la propiedad real. `sw.js` → `control-pagos-v37`.
- **2026-09-15**: 🎨 Rediseño de la pantalla de acceso a estándar empresarial + 🐛 **fix de un error que rompía la app entera.**
  - **El bug (no llegó a producción, se detectó al validar):** `aplicarTema()` corre al cargar la página y llamaba a `redibujarBotonGoogle()`, que lee `googleInicializado`, declarada con `let` mucho más abajo. Zona muerta temporal → `ReferenceError` → **el script inline moría ahí y la app quedaba en blanco**, no solo el login. Un `typeof fn === 'function'` NO protege: las funciones se izan, las `let`/`const` no. Solución: `var redibujarGoogleListo = null;` declarada arriba (con `var`, que vale `undefined` en vez de lanzar) y asignada al final del bloque de sesión.
  - **Nuevo banco de pruebas: [prueba-frontend.js](prueba-frontend.js)** — `node prueba-frontend.js index.html`. Detecta **zonas muertas temporales de forma transitiva** (A llama a B, y B lee una variable declarada después: así se escapó este error en el primer intento del detector), ids duplicados, `getElementById` a ids inexistentes, y que el **Client ID coincida entre `index.html` y `apps-script.gs`** — si difieren, el servidor rechaza todos los tokens por el chequeo de `aud` y el login falla sin causa evidente. Verificado que el detector falla con el bug reintroducido y pasa sin él.
  - **El botón de Google:** lo dibuja Google y no hereda nuestro CSS, así que en tema oscuro salía un recuadro blanco flotando. Ahora se le pasan las opciones para que quede integrado (`filled_black`/`outline` según el tema, `rectangular`, ancho completo de la tarjeta) y **se vuelve a dibujar al cambiar de tema y al cambiar el ancho de la ventana**, porque sus opciones son fijas al renderizar.
  - Pantalla rediseñada: halo radial tenue de fondo, tarjeta más amplia, separador "Acceso corporativo", nota explicativa y franja de marca. `sw.js` → `control-pagos-v36`.
- **2026-09-15**: 🔐 **Fase 2, frontend listo.** Pantalla de acceso con Google Identity Services, alta de usuarios nuevos (nombre + teléfono → queda `pendiente`), identidad en el encabezado con botón Salir, y sección **Configuración** para administradores (tabla de usuarios con rol, estado, secciones y último acceso; modal para crear/editar; los pendientes se ordenan primero porque son los que piden acción). El `idToken` se adjunta **automáticamente** en `postAppsScript()` para no depender de acordarse en cada llamada, y `manejarErrorDeSesion()` devuelve al login cuando el servidor rechaza la sesión. Client ID cargado en los dos lados (tiene que coincidir: el servidor valida `aud`). `sw.js` → `control-pagos-v35`. **`index.stable.html` queda en v34** hasta que el usuario lo pruebe.
  - **El interruptor vive solo en el servidor.** La app pregunta `?action=estado_login` al arrancar, así que `MODO_LOGIN` se cambia en el Apps Script y no hay que republicar el frontend.
  - **Convivencia con `?vista=gastos`.** Los dos mecanismos se pisaban: `aplicarPermisos()` corre después y le deshacía el filtrado al link viejo. Resuelto así: con `MODO_LOGIN = 'off'` manda `?vista=gastos` y `aplicarPermisos()` no toca nada; apenas el login se enciende, `desactivarVistaRestringida()` restaura el `#fTipo` y las etiquetas originales (guardados al arrancar) y manda la sesión. Cuando todos estén migrados, el bloque de `?vista=gastos` se puede borrar entero.
  - **Anti-bloqueo.** La pantalla de acceso arranca visible para que no se vea contenido detrás, lo que crea el riesgo de dejar la app tapada si algo falla. Hay tres defensas: timeout de 8s en la consulta, un salvavidas que destapa a los 12s pase lo que pase, y que cualquier fallo se interpreta como `'off'` (sistema usable) en vez de bloquear — la restricción real la hace el servidor igual.
- **2026-09-15**: 🔐 **Fase 2, backend listo** (bloque D de [apps-script.gs](apps-script.gs)). Hoja `USUARIOS`, verificación del ID token de Google contra `oauth2.googleapis.com/tokeninfo` (validando `aud` = nuestro Client ID, `email_verified` y `exp`), `contextoDe_()` como único punto por donde pasa toda petición, y filtrado **en el servidor**: `consultarPagos_(ctx)` lee solo las hojas permitidas, así que el navegador nunca recibe datos de una sección ajena. Acciones nuevas: `iniciar_sesion`, `registrar_usuario`, `listar_usuarios`, `guardar_usuario`, más `consultar_pagos` por POST (para no mandar el token en la URL, donde quedaría en el historial y en los logs). Decisiones tomadas por el usuario: dentro de una sección se ven **todos** los registros (no solo los propios); los usuarios actuales se **precargan antes** de encender el login. `MODO_LOGIN` sigue en `'off'`: nada cambia todavía.
  - **Banco de pruebas: [prueba-permisos.js](prueba-permisos.js)** — 29 comprobaciones de la lógica de acceso con las APIs de Google stubbeadas. Correr con `node prueba-permisos.js apps-script.gs`. **Re-correrlo ante cualquier cambio en el bloque D**; cubre el filtrado por sección, que `USUARIOS` y `SOLICITUDES` nunca se devuelvan como pagos, que secciones inventadas se descarten, y la red de seguridad que impide dejar el sistema sin ningún admin activo.
- **2026-09-15**: 🧹 Eliminado el filtro **"Número de pago"** de Consultar Pagos: buscaba en una columna `NUMERO DE FACTURA` que no existe en el Sheet, así que cualquier búsqueda por ese campo devolvía cero resultados. Se quitaron las 7 referencias (una de ellas, en "Limpiar filtros", habría tirado un error al quedar huérfana). `sw.js` → `control-pagos-v34`.
- **2026-09-15**: 🎨 Fix de alineación del calendario: los números no coincidían con los nombres de día (LUN…DOM). Causa: flatpickr arma las dos filas con geometrías distintas — `.flatpickr-weekdaycontainer` da a cada nombre `flex:1` (1/7 exacto del ancho), mientras `.dayContainer` usa `flex-wrap` + `justify-content:space-around` sobre celdas con ancho tope (`.flatpickr-day` tiene `max-width`, que acá está en 34px). Con `space-around` los días quedaban repartidos con medio hueco en cada borde → desfase creciente hacia el domingo. Se destapó al poner `width:100%` para arreglar el domingo cortado (2026-08-30): ensanchar el contenedor hizo visible el desfase. **Fix: las dos filas van a la misma grilla `repeat(7, 1fr)` con `justify-items:center`**, y la pastilla de 34px se centra en su celda (274px útiles ÷ 7 = 39,1px por columna, holgura 2,6px por lado). ⚠️ Si alguna vez se cambia el ancho de `.flatpickr-calendar` (hoy 300px) o el tamaño de `.flatpickr-day`, verificar que la pastilla siga entrando en la columna. `sw.js` → `control-pagos-v33`. Confirmado visualmente por el usuario y sincronizado en `index.stable.html`.
- **2026-09-15**: ✅ **VERSIÓN ESTABLE — cierre de la Fase 1.** Etiquetada en git como **`v1.0-fase1`** (`git checkout v1.0-fase1` para volver a este punto exacto). Incluye: n8n fuera del sistema por completo, una hoja y una carpeta por sección, los tipos Seguridad Social y Pago Nómina, y la migración de datos históricos ya ejecutada. `index.stable.html` = `index.html`, `sw.js` = `control-pagos-v32`.
  - **Migración ejecutada y conciliada** (2026-09-15 19:48): 56 filas movidas (52 viáticos + 4 caja menor). Verificado contra la API que los 97 registros reales siguen siendo 97 y que la suma de `VALOR FACTURA` es idéntica antes y después ($84.868.561). Respaldo automático en Drive: `RESPALDO CONTROL DE PAGOS 2026-09-15 19.48`.
  - ⚠️ **Al conciliar, descontar los registros de prueba.** El primer chequeo dio diferencias que parecían pérdida de datos pero eran pruebas manuales creadas/borradas entre una captura y otra. También hay un duplicado real y legítimo en los datos (dos peajes del 9/11 por $13.200) que **ya existía antes** de migrar — no confundirlo con un error de la migración.
- **2026-09-15**: 🛡️ Blindaje de la migración antes de correrla sobre datos reales. (a) Nueva `simularMigracion()`, de **solo lectura**: dice cuántas filas se moverían, a qué hoja, cuántas se quedan, y valida encabezados — sin tocar nada. (b) Nueva `verificarEncabezados_()`: la migración copia las filas **por posición de columna**, así que si una hoja destino tuviera los encabezados en otro orden los datos caerían en la columna equivocada **en silencio**; ahora se verifican **todas** las hojas destino antes de escribir nada, y si una falla no se movió ni se borró nada. (c) `SpreadsheetApp.flush()` entre copiar y borrar. (d) El borrado agrupa filas contiguas en `deleteRows(inicio, cantidad)` en vez de ~56 `deleteRow()` sueltos, para no acercarse al límite de 6 minutos. Orden de uso: `simularMigracion()` → revisar → `migrarPagosAHojasPorSeccion()`.
- **2026-09-15**: ✅ Fase 1 verificada en producción tras el redespliegue: `consultar_pagos` y `consultar_solicitudes` devuelven `application/json` con CORS OK; 99 registros consolidados de 3 hojas distintas; los tipos nuevos (`seguridad_social`, `nomina`) crean su hoja y su carpeta solas al primer registro, con los encabezados copiados de la principal. Hoja principal real: **`PAGOS REGISTRADOS`**.
- **2026-09-15**: 🐛 Fix en el Apps Script tras el primer despliegue de la Fase 1 (Version 4): el Web App devolvía una página HTML de error, `ReferenceError: Cannot access 'NOMBRE_HOJA_SOLICITUDES' before initialization`. Causa: `const HOJAS_NO_PAGOS = [NOMBRE_HOJA_SOLICITUDES, ...]` estaba declarada arriba (bloque de secciones) pero `NOMBRE_HOJA_SOLICITUDES` se declara mucho más abajo (bloque de Aprobaciones) — zona muerta temporal de `const`. Se reemplazó por la función `hojasNoPagos_()`, que evalúa recién al llamarse y por lo tanto no depende del orden del archivo. **Lección: `node --check` valida sintaxis pero NO detecta errores de orden en tiempo de ejecución**; para el Apps Script hay que probar el endpoint real con `curl` después de desplegar. Ojo: cuando el Web App falla así devuelve `Content-Type: text/html` sin `Access-Control-Allow-Origin` — el mensaje real está en el HTML, no en un JSON.
- **2026-09-15**: 🔄 **Fase 1 de la actualización grande.** (a) "Nuevo Pago" ahora envía a `postAppsScript({action:'registrar_pago'})` con los archivos en base64, y "Consultar Pagos" lee de `?action=consultar_pagos`; **se eliminaron `N8N_WEBHOOK_URL` y `N8N_QUERY_URL`** — n8n ya no participa en ninguna parte del sistema. (b) Backend: `SECCIONES`, `hojaDeSeccion_()`, `carpetaDeSeccion_()`, `subirArchivosASeccion_()`, `registrarPago_()`, `consultarPagos_()` y `migrarPagosAHojasPorSeccion()` (con respaldo automático del Sheet). (c) `leerDatos_()` reescrito para consolidar **todas** las hojas de pagos, si no los reportes se habrían roto en silencio tras migrar. (d) Dos tipos nuevos, **Seguridad Social** (teal `#0d9488`) y **Pago Nómina** (naranja `#ea580c`), en los dos selectores, en el filtro y en `tipoInfo()` — con su CSS `.tipo-btn.active[data-value=...]` puesto **antes** que los botones, porque olvidarlo ya fue un bug en Viáticos/Caja Menor. `sw.js` → `control-pagos-v32`.
- **2026-09-15**: ✅ Marcada como **versión estable** — `index.stable.html` = `index.html`. Incluye el módulo de Aprobaciones completo y operativo (Apps Script v3), correos HTML y las mitigaciones de rendimiento.
- **2026-09-15**: Mitigaciones de lentitud en Aprobaciones tras prueba real del usuario (falso "No se pudo conectar" pese a que la solicitud sí se guardaba). Se descartó CORS con `curl`; era latencia. Cambios: un solo envío de correo a ambos admins, verificación post-fallo (`solicitudExiste()`), timeout de 120s con `AbortController`, caché local de la lista con pintado instantáneo, filtros de estado sin ir al servidor, y actualización optimista al aprobar/rechazar. Ver sección "⚡ Rendimiento de Aprobaciones" arriba. `sw.js` → `control-pagos-v31`.
- **2026-09-15**: Correos de Aprobaciones rediseñados en **HTML corporativo** (`plantillaCorreo_()` + helpers `filaDetalle_`, `enlacesArchivos_`, `etiquetaTipo_` en el Apps Script): encabezado azul con la marca, badge de estado con color según el caso (ámbar pendiente / verde aprobada / rojo rechazada), monto destacado, tabla de detalles y botón a la app. Se mandan con `htmlBody` + fallback de texto plano. En "Revisar Solicitudes" se agregó botón **Actualizar**, estado de carga y anti-caché (`&_=Date.now()`) en la consulta, porque las solicitudes recién creadas tardaban en aparecer. `sw.js` → `control-pagos-v31`.
- **2026-09-15**: ✅ Apps Script desplegado como Web App y conectado (`APPS_SCRIPT_URL` con la URL real). Se quitaron las guardas `=== 'PENDIENTE_CONFIGURAR'` que quedaron como código muerto. El módulo de Aprobaciones queda operativo end-to-end. `sw.js` → `control-pagos-v31`.
- **2026-09-15**: Se quita el auto-registro en "Control de Pagos" al aprobar (función `registrarPagoOficial_` eliminada del Apps Script). A pedido del usuario, aprobar es **solo un visto bueno visual** + notificación al solicitante. No reintroducir sin que lo pida.
- **2026-09-15**: 🚫 **Se abandona n8n para desarrollos nuevos** (pedido explícito del usuario). El módulo de Aprobaciones se re-cableó de 3 webhooks de n8n a un solo **Google Apps Script Web App** (`APPS_SCRIPT_URL`, archivo [apps-script.gs](apps-script.gs) con el backend completo: crear solicitud, consultar, aprobar/rechazar, subir archivos a Drive y notificar por correo). Archivos van en base64 dentro del JSON y los POST usan `Content-Type: text/plain` para evitar el preflight CORS. `sw.js` → `control-pagos-v31`.
- **2026-09-15**: Frontend completo del módulo "Aprobaciones" (tercera pestaña: solicitar pago → revisar → aprobar/rechazar). Refactor de `initSelectorTipo()`/`initUploadZone()`/`initFormateadorValor()` para reusar la lógica entre "Nuevo Pago" y "Nueva Solicitud". `sw.js` → `control-pagos-v31`.
- **2026-09-15**: ✅ Marcada como **versión estable** — `index.stable.html` = `index.html` (incluye exportación a Excel/PDF).
- **2026-09-14**: Botones "Excel" y "PDF" en "Consultar Pagos" para descargar la consulta actual (respeta filtros y vista restringida). Client-side con SheetJS + jsPDF/autotable (CDN, precacheados en `sw.js`). Refactor: `tipoInfo()`/`valorDe()` helpers extraídos para no duplicar lógica entre `renderResultados()` y la exportación. Ver sección "📤 Exportar consulta" arriba. `sw.js` → `control-pagos-v23`.
- **2026-09-10**: ✅ Marcada como **versión estable** — `index.stable.html` = `index.html` (incluye Viáticos/Caja Menor, vista `?vista=gastos`, y el fix visual de selección).
- **2026-09-10**: Fix visual — se agrega el CSS `.tipo-btn.active[data-value="viaticos"]` y `[data-value="caja_menor"]` (faltaba desde que se crearon los botones), así que ahora al hacer clic sí se ve el borde/fondo/color de selección, igual que en los 4 tipos originales. `sw.js` → `control-pagos-v22`.
- **2026-09-10**: Simplificado el modo de vista restringida a un solo link `?vista=gastos` (antes dos links, `?vista=viaticos` y `?vista=caja_menor`). Ahora "Nuevo Pago" muestra solo los botones Viáticos/Caja Menor (elección real, sin auto-fill) y "Consultar Pagos" limita las opciones del `<select>` de tipo a esas dos, con un filtro duro adicional en `filtrarRows()`. `sw.js` → `control-pagos-v21`.
- **2026-09-10**: Se agregan tipos de pago "Viáticos" y "Caja Menor" (botones, badges, opciones de filtro) y modo de vista restringida por `?vista=viaticos`/`?vista=caja_menor` en `index.html` — oculta el selector/filtro de tipo y fuerza el resultado a esa categoría, pensado para dar acceso limitado a dos personas nuevas sin exponer el resto de pagos. Filtrado solo en cliente (decisión del usuario, no en n8n) — ver sección "🔗 Vista restringida por link" arriba para el detalle y las limitaciones (incluye una de instalación como PWA). `sw.js` → `control-pagos-v20`.
- **2026-08-31**: Panel principal (`main`) ampliado de `max-width: 880px` a `968px` (+10%) porque la tabla de resultados (ahora con "Nombre del pago" y "Registrado por") desbordaba y cortaba la columna "Archivo". `sw.js` → `control-pagos-v19`. Además, se subió el timeout del hook de auto-push de 30s a 60s (ver nota operativa arriba) tras dos fallos silenciosos de `git push`.
- **2026-08-31**: Se agrega columna "Nombre del pago" (`r['NOMBRE DE PAGO']`) en `renderResultados()`, ubicada entre "Tipo" y "Proveedor" en el encabezado y en cada fila. `sw.js` → `control-pagos-v18`.
- **2026-08-30**: ✅ Marcada como **versión estable**. Además, se detectó y corrigió que el commit del hook de `Stop` había quedado sin `push` a GitHub (branch "ahead by 1"); se subió manualmente. Ver nota operativa arriba sobre este modo de falla.
- **2026-08-30**: (a) `.app-nav` (menú Nuevo Pago/Consultar Pagos) ahora usa `position: sticky; top: 56px;` para quedar fijo bajo el header al hacer scroll. (b) Se agrega columna "Registrado por" en la tabla de resultados de `renderResultados()` — muestra `r['REGISTRADO POR']`, dato que ya se registraba pero no se mostraba. `sw.js` → `control-pagos-v17`.
- **2026-08-30**: Segundo fix del bug "tema claro no funciona" (el primero, `color-scheme` en CSS, no fue suficiente en Android). Causa real: Chrome en Android tiene una función de "oscurecimiento automático de páginas web" que se activa cuando el teléfono está en modo oscuro, y solo se desactiva si la página declara explícitamente en qué modo está vía `<meta name="color-scheme">` en el `<head>` — no basta con la propiedad CSS. Se agregó `<meta name="color-scheme" id="colorSchemeMeta" content="light">` y se sincroniza su `content` con `data-theme` en cada toggle (función `aplicarTema()` en index.html). Reportado por el usuario: "le doy clic al botón y se aclara un poquito pero no llega a blanco". `sw.js` → `control-pagos-v16`.
- **2026-08-26**: Fix bug "tema claro no funciona" en la PWA — se agrega `color-scheme: light` en `:root` y `color-scheme: dark` en `[data-theme="dark"]` (index.html). Sin esto, los controles nativos del navegador (selects, inputs, scrollbars) ignoraban el `data-theme` de la app y seguían el modo oscuro/claro del sistema operativo, dando la impresión de que el tema claro estaba roto cuando el SO estaba en modo oscuro. `sw.js` → `control-pagos-v15`.
- **2026-08-18**: ✅ Marcada como **versión estable**. Se agrega `enviarReporteMensual()` al Apps Script (reporta el mes anterior completo, trigger Month timer día 1) y se ajusta `enviarReporteDiario()` para filtrar solo los registros de ese día (antes mandaba todo el histórico). Ambos usan Sheet temporal + export PDF/XLSX. Ver sección "📧 Reportes automáticos" arriba.
- **2026-08-18**: Configurado reporte diario automático (PDF+Excel, histórico completo) vía Google Apps Script, con trigger "Time-based" ya activo. Enviado a nathan@ylevigroup.com, joseph@ylevigroup.com y contabilidad@energy-millennium.com. No usa n8n.
- **2026-08-18**: Frontend para múltiples archivos en "Nuevo Pago" (`selectedFiles[]`, input `multiple`, lista de previsualización removible) y botón "+ Agregar" en "Consultar Pagos" para subir factura a registros sin archivo (modal nuevo, `N8N_ADDFILE_URL` placeholder). Requiere trabajo pendiente en n8n — ver sección "🔧 Pendiente en n8n" arriba. `sw.js` → `control-pagos-v14`.
- **2026-08-18**: Se elimina la columna "N° Pago" de la tabla de resultados en "Consultar Pagos" (`renderResultados()` en index.html — encabezado `<th>` y celda `r['NUMERO DE FACTURA']` quitados). El filtro "Número de pago" en el formulario de búsqueda se mantiene sin cambios. `sw.js` → `control-pagos-v13`.
- **2026-08-18**: Resultados de "Consultar Pagos" se ordenan de más reciente a más vieja por `FECHA DE PAGO` (`filtrarRows()` en index.html, antes no tenían ningún orden garantizado). `sw.js` → `control-pagos-v12`.
- **2026-08-12**: ✅ Marcada como **versión estable** por el usuario — `index.stable.html` = `index.html` (incluye: fix del calendario de flatpickr y panel ampliado a 880px).
- **2026-08-12**: Fix de bug en el calendario de flatpickr — `.flatpickr-days`/`.flatpickr-innerContainer`/`.flatpickr-rContainer` no tenían `width: 100% !important`, así que flatpickr calculaba internamente un ancho basado en el tamaño de celda por defecto (más grande que nuestro tema de 34px) y eso recortaba visualmente la última columna (domingo). Además, panel principal (`main`) ampliado de `max-width: 736px` a `880px` (+20%, decisión del usuario tras comparar opciones). `sw.js` → `control-pagos-v11`.
- **2026-08-04**: ✅ Incidente de cuenta de Google del backend resuelto por completo (Drive + Sheets recreados, nodos de n8n re-apuntados, encabezados del Sheet corregidos). Marcada como **versión estable** por el usuario. Ver sección de incidente arriba.
- **2026-07-30**: Incidente — cuenta de Google del backend (Drive + Sheets) eliminada por error. Se creó cuenta nueva, credenciales configuradas en Google Console y en n8n. Ver sección de incidente arriba.
- **2026-07-01**: ✅ Marcada como **versión estable** por el usuario — `index.stable.html` = `index.html` (incluye: fix de filtro con `.toLowerCase()`, eliminación de "Número de pago" en Nuevo Pago, ancho ampliado a 736px, `sw.js` v10).
- **2026-07-01**: Contenedor principal `main` ampliado de `max-width: 640px` a `736px` (+15%, index.html línea ~173) para reducir la sensación de vista angosta, especialmente en la tabla de "Consultar Pagos". `sw.js` → `control-pagos-v10`.
- **2026-07-01**: Se elimina el campo "Número de pago" (`numeroFactura` / `numero_factura`) del formulario "Nuevo Pago" en `index.html` — ya no se muestra, no se valida como requerido, y no se envía en el `formData` al webhook de n8n. **Nota:** el filtro "Número de pago" en "Consultar Pagos" (`fNumeroFactura`) se mantiene, ya que sirve para buscar registros antiguos que sí tienen ese dato.
- **2026-07-01**: Fix bug en filtro de "Consultar Pagos" — campos como `NUMERO DE FACTURA`, `EMPRESA`, `TIPO FACTURA` y `PROVEEDOR` pueden llegar como número desde n8n; se envuelven en `String(...)` antes de `.toLowerCase()` en `filtrarRows()` y `renderResultados()` (index.html). Se sincroniza `index.stable.html`.
- **2026-07-01**: Creación de `CONTEXT.md` y `CLAUDE.md` para mantener contexto entre sesiones.
- **2026-05-20**: Varios ajustes iterativos (auto-commits), incluyendo "Trigger redeploy: Pago Impuestos".
- **2026-04-21**: Fix de overflow de tabla en resultados; extracción de URL desde fórmulas `HYPERLINK` de Google Sheets; agregado de log de depuración.
- **2026-04-15**: Commit inicial de la PWA "Control de Pagos".

## Pendientes / próximos pasos
- ~~Desplegar el Apps Script de Aprobaciones~~ ✅ hecho el 2026-09-15.
- Construir en n8n el soporte para múltiples archivos (Code + Aggregate en el workflow de "Nuevo Pago") y el nuevo workflow "Agregar Factura", más la columna "ID REGISTRO" en el Sheet. Ver sección "🔧 Pendiente en n8n" arriba para la guía paso a paso.
- Una vez creado el webhook "Agregar Factura", reemplazar el placeholder `N8N_ADDFILE_URL` en `index.html` con la URL real.

---
### Cómo mantener este documento
Cada vez que se implemente un cambio relevante (nueva funcionalidad, fix importante, cambio de arquitectura, nueva versión estable), agregar una entrada en **Historial de cambios recientes** con fecha y descripción breve, y actualizar **Última actualización** arriba.
