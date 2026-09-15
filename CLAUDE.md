# Instrucciones para trabajar en este repositorio

- Antes de empezar a trabajar, lee [CONTEXT.md](CONTEXT.md) para entender el estado actual del proyecto.

## 🚫 Regla de arquitectura: no usar n8n en desarrollos nuevos
El usuario pidió explícitamente (2026-09-15) **no depender más de n8n**. Para cualquier funcionalidad nueva que necesite backend (guardar datos, subir archivos, enviar correos), usar el **Google Apps Script** que ya está vinculado al Sheet "CONTROL DE PAGOS", desplegado como Web App. Ventaja adicional: el código lo podemos escribir completo nosotros (ver [apps-script-aprobaciones.gs](apps-script-aprobaciones.gs) como referencia), en vez de guiar al usuario paso a paso por la GUI de n8n.

Los módulos viejos (Nuevo Pago, Consultar Pagos, Agregar Factura) **siguen en n8n y no se tocan** — funcionan, y migrarlos sin que el usuario lo pida es riesgo innecesario.

Si se edita el Apps Script, mantener sincronizada la copia versionada en el repo, y recordarle al usuario que debe redesplegar (**Deploy → Manage deployments → ✏️ → New version**) para que el cambio tenga efecto.

## Checklist obligatorio al terminar CUALQUIER cambio en `index.html` (o cualquier asset cacheado)
El usuario requiere que todo cambio se refleje automáticamente tanto en la versión web como en la PWA instalada, sin pasos manuales de su parte. Por eso, siempre que se toque `index.html`, antes de dar el cambio por terminado:

1. **Sube la versión de `CACHE` en `sw.js`** (ej. `control-pagos-v9` → `v10`). Es el paso que dispara la auto-actualización; si se olvida, los usuarios (web y PWA instalada) siguen viendo la versión vieja indefinidamente porque el Service Worker es cache-first.
2. **Sincroniza `index.stable.html`** con el `index.html` actualizado (`cp -f index.html index.stable.html`), salvo que el cambio sea explícitamente experimental/no estable.
3. **Actualiza [CONTEXT.md](CONTEXT.md)**: agrega una entrada en "Historial de cambios recientes" con fecha y descripción breve, y actualiza "Última actualización".
4. No hace falta hacer commit/push manual: hay un hook de `Stop` en `.claude/settings.local.json` que hace `git add -A`, `commit` y `push origin main` automáticamente al finalizar el turno si hay cambios. Pero el push solo actualiza GitHub Pages (la web) — el paso 1 es el que hace que la PWA instalada también se refresque sola.
