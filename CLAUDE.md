# Instrucciones para trabajar en este repositorio

- Antes de empezar a trabajar, lee [CONTEXT.md](CONTEXT.md) para entender el estado actual del proyecto.
- Después de cualquier cambio relevante (nueva funcionalidad, fix, cambio de arquitectura, o al guardar `index.stable.html` como nueva versión estable), **actualiza [CONTEXT.md](CONTEXT.md)**: agrega una entrada en "Historial de cambios recientes" con la fecha y una descripción breve, y actualiza "Última actualización".
- No hace falta hacer commit/push manual: hay un hook de `Stop` en `.claude/settings.local.json` que hace `git add -A`, `commit` y `push origin main` automáticamente al finalizar cada turno si hay cambios.
