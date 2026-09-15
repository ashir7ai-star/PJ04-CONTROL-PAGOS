# Contexto del Proyecto — Control de Pagos (PJ04)

> Documento vivo. Se actualiza cada vez que se hace un cambio relevante para que cualquier sesión (o persona) pueda retomar el proyecto sin perder contexto.

## Última actualización
**2026-09-15** — ✅ Módulo **"Aprobaciones"** desplegado y funcionando. 🚫 **Decisión de arquitectura: este módulo y todo desarrollo futuro NO usan n8n** — el backend es un **Google Apps Script Web App** ya en producción (código en [apps-script.gs](apps-script.gs)). Ver sección "✅ Módulo de Aprobaciones" abajo. `sw.js` → `control-pagos-v30`.

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
| PWA | `manifest.json` (scope `/PJ04-CONTROL-PAGOS/`) + `sw.js` (Service Worker, cache-first, versión de caché actual: `control-pagos-v30`) |
| Backend | **n8n** (self-hosted en `ashir-n8n.nr6aco.easypanel.host`), vía dos webhooks: |
| — Registrar pago | `POST /webhook/81926c9e-22aa-4aef-bb4d-fe4ee520748c` (`N8N_WEBHOOK_URL`) — workflow: Webhook → **Upload file** (Google Drive) → **Append row in sheet** (Google Sheets) → Respond to Webhook |
| — Consultar pagos | `GET /webhook/c6d11abd-61bc-439c-9dd9-550ed5008ee3` (`N8N_QUERY_URL`) — probablemente lee del mismo Google Sheet |
| Almacenamiento real | Google Drive (carpeta "PJ04 FACTURAS", credencial n8n "PJ04 DRIVE") + Google Sheet "CONTROL DE PAGOS" (credencial n8n "PJ04 SHEET") — ⚠️ el nombre exacto de la pestaña/tab **no está confirmado** tras la migración de cuenta (se asumía "Millennium", pero un script de Apps Script confirmó que `getSheetByName('Millennium')` devuelve `null` en el Sheet actual — probablemente ahora se llama "Sheet1" u otro nombre por defecto). Si algo necesita el nombre exacto de la pestaña, verificarlo primero en el Sheet en vez de asumir "Millennium". |
| Reporte diario | Google Apps Script (bound al Sheet, independiente de n8n) — ver sección "📧 Reporte diario automático" |
| Hosting | GitHub Pages (por el `scope`/`start_url` del manifest) |
| Repo | https://github.com/ashir7ai-star/PJ04-CONTROL-PAGOS |

## ✅ Módulo de Aprobaciones — 2026-09-15, **desplegado y en producción**

**Web App URL (en `APPS_SCRIPT_URL` de index.html):**
`https://script.google.com/macros/s/AKfycbxI_QKiefk2Azp_SO4ASNwRha13h7zrvEy4vCAABQHWpc_OULETbMOuOrL8uIq6cQaGKQ/exec`
Desplegado como Web app · Execute as: Me · Who has access: Anyone. Verificado con `curl` (devuelve `[]`). Nota: si se prueba con `curl` sin User-Agent de navegador, Google devuelve HTML en vez del JSON — no es un error de la app, hay que mandar `-H "User-Agent: Mozilla/5.0"`.

### 🚫 Decisión de arquitectura: NO usar n8n (2026-09-15)
El usuario pidió explícitamente **no depender de n8n en este módulo ni en desarrollos futuros**. Por eso el backend de Aprobaciones se implementó como un **Google Apps Script Web App**, en el MISMO proyecto de Apps Script que ya existe en el Sheet (el de los reportes diario/mensual). Ventajas: ya está en la cuenta correcta, tiene acceso nativo a Sheets/Drive/Gmail, y el código lo escribe Claude completo (a diferencia de n8n, que requería armar nodos a mano en su GUI).

**Los módulos VIEJOS siguen en n8n** (Nuevo Pago, Consultar Pagos, Agregar Factura) — no se migraron porque ya funcionan y migrarlos es un riesgo innecesario. Si en el futuro se quiere consolidar todo en Apps Script, sería un proyecto aparte, a decidir con el usuario.

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

## Historial de cambios recientes
- **2026-09-15**: Mitigaciones de lentitud en Aprobaciones tras prueba real del usuario (falso "No se pudo conectar" pese a que la solicitud sí se guardaba). Se descartó CORS con `curl`; era latencia. Cambios: un solo envío de correo a ambos admins, verificación post-fallo (`solicitudExiste()`), timeout de 120s con `AbortController`, caché local de la lista con pintado instantáneo, filtros de estado sin ir al servidor, y actualización optimista al aprobar/rechazar. Ver sección "⚡ Rendimiento de Aprobaciones" arriba. `sw.js` → `control-pagos-v30`.
- **2026-09-15**: Correos de Aprobaciones rediseñados en **HTML corporativo** (`plantillaCorreo_()` + helpers `filaDetalle_`, `enlacesArchivos_`, `etiquetaTipo_` en el Apps Script): encabezado azul con la marca, badge de estado con color según el caso (ámbar pendiente / verde aprobada / rojo rechazada), monto destacado, tabla de detalles y botón a la app. Se mandan con `htmlBody` + fallback de texto plano. En "Revisar Solicitudes" se agregó botón **Actualizar**, estado de carga y anti-caché (`&_=Date.now()`) en la consulta, porque las solicitudes recién creadas tardaban en aparecer. `sw.js` → `control-pagos-v30`.
- **2026-09-15**: ✅ Apps Script desplegado como Web App y conectado (`APPS_SCRIPT_URL` con la URL real). Se quitaron las guardas `=== 'PENDIENTE_CONFIGURAR'` que quedaron como código muerto. El módulo de Aprobaciones queda operativo end-to-end. `sw.js` → `control-pagos-v30`.
- **2026-09-15**: Se quita el auto-registro en "Control de Pagos" al aprobar (función `registrarPagoOficial_` eliminada del Apps Script). A pedido del usuario, aprobar es **solo un visto bueno visual** + notificación al solicitante. No reintroducir sin que lo pida.
- **2026-09-15**: 🚫 **Se abandona n8n para desarrollos nuevos** (pedido explícito del usuario). El módulo de Aprobaciones se re-cableó de 3 webhooks de n8n a un solo **Google Apps Script Web App** (`APPS_SCRIPT_URL`, archivo [apps-script.gs](apps-script.gs) con el backend completo: crear solicitud, consultar, aprobar/rechazar, subir archivos a Drive y notificar por correo). Archivos van en base64 dentro del JSON y los POST usan `Content-Type: text/plain` para evitar el preflight CORS. `sw.js` → `control-pagos-v30`.
- **2026-09-15**: Frontend completo del módulo "Aprobaciones" (tercera pestaña: solicitar pago → revisar → aprobar/rechazar). Refactor de `initSelectorTipo()`/`initUploadZone()`/`initFormateadorValor()` para reusar la lógica entre "Nuevo Pago" y "Nueva Solicitud". `sw.js` → `control-pagos-v30`.
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
