# Contexto del Proyecto — Control de Pagos (PJ04)

> Documento vivo. Se actualiza cada vez que se hace un cambio relevante para que cualquier sesión (o persona) pueda retomar el proyecto sin perder contexto.

## Última actualización
**2026-08-30** — ✅ Confirmado por el usuario que el fix del tema claro (Android auto-dark) ya funciona. Además: (1) el menú "Nuevo Pago / Consultar Pagos" (`.app-nav`) ahora queda fijo (`position: sticky`) al hacer scroll, debajo del header; (2) se agrega la columna "Registrado por" a la tabla de resultados de "Consultar Pagos", para saber quién registró cada pago. `sw.js` → `control-pagos-v17`.

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
| PWA | `manifest.json` (scope `/PJ04-CONTROL-PAGOS/`) + `sw.js` (Service Worker, cache-first, versión de caché actual: `control-pagos-v17`) |
| Backend | **n8n** (self-hosted en `ashir-n8n.nr6aco.easypanel.host`), vía dos webhooks: |
| — Registrar pago | `POST /webhook/81926c9e-22aa-4aef-bb4d-fe4ee520748c` (`N8N_WEBHOOK_URL`) — workflow: Webhook → **Upload file** (Google Drive) → **Append row in sheet** (Google Sheets) → Respond to Webhook |
| — Consultar pagos | `GET /webhook/c6d11abd-61bc-439c-9dd9-550ed5008ee3` (`N8N_QUERY_URL`) — probablemente lee del mismo Google Sheet |
| Almacenamiento real | Google Drive (carpeta "PJ04 FACTURAS", credencial n8n "PJ04 DRIVE") + Google Sheet "CONTROL DE PAGOS" (credencial n8n "PJ04 SHEET") — ⚠️ el nombre exacto de la pestaña/tab **no está confirmado** tras la migración de cuenta (se asumía "Millennium", pero un script de Apps Script confirmó que `getSheetByName('Millennium')` devuelve `null` en el Sheet actual — probablemente ahora se llama "Sheet1" u otro nombre por defecto). Si algo necesita el nombre exacto de la pestaña, verificarlo primero en el Sheet en vez de asumir "Millennium". |
| Reporte diario | Google Apps Script (bound al Sheet, independiente de n8n) — ver sección "📧 Reporte diario automático" |
| Hosting | GitHub Pages (por el `scope`/`start_url` del manifest) |
| Repo | https://github.com/ashir7ai-star/PJ04-CONTROL-PAGOS |

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

## Historial de cambios recientes
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
- Construir en n8n el soporte para múltiples archivos (Code + Aggregate en el workflow de "Nuevo Pago") y el nuevo workflow "Agregar Factura", más la columna "ID REGISTRO" en el Sheet. Ver sección "🔧 Pendiente en n8n" arriba para la guía paso a paso.
- Una vez creado el webhook "Agregar Factura", reemplazar el placeholder `N8N_ADDFILE_URL` en `index.html` con la URL real.

---
### Cómo mantener este documento
Cada vez que se implemente un cambio relevante (nueva funcionalidad, fix importante, cambio de arquitectura, nueva versión estable), agregar una entrada en **Historial de cambios recientes** con fecha y descripción breve, y actualizar **Última actualización** arriba.
