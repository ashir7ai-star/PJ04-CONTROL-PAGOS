# Imagen de pj04-pagos-api para EasyPanel.
#
# Alpine porque la imagen queda chica y arranca rápido: un contenedor liviano
# significa despliegues de segundos, no de minutos.
FROM node:20-alpine

WORKDIR /app

# Las dependencias se instalan ANTES de copiar el código. Así, si solo cambia
# el código, Docker reutiliza esta capa y el despliegue no vuelve a bajar todo.
COPY servidor/package.json servidor/package-lock.json* ./servidor/
RUN cd servidor && npm ci --omit=dev || (cd /app/servidor && npm install --omit=dev)

# El servidor carga la lógica de negocio desde apps-script.gs, que vive en la
# raíz del repositorio. Es el MISMO archivo que corre hoy en Apps Script: esa
# es toda la idea de la migración.
COPY apps-script.gs ./apps-script.gs
COPY servidor ./servidor

ENV NODE_ENV=production
ENV PORT=8080
ENV ZONA_HORARIA=America/Bogota

EXPOSE 8080

# Sin usuario root: si algún día alguien consigue ejecutar algo dentro del
# contenedor, que no lo haga como administrador.
USER node

CMD ["node", "servidor/src/servidor.js"]
