FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Lookups DNS de containers parados levam ~5 s e ocupam o threadpool;
# um pool maior evita que travem as verificações dos demais serviços.
ENV UV_THREADPOOL_SIZE=16
# Diretório da chave mestra (volume dashboard_data)
ENV DATA_DIR=/data
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/healthz || exit 1
CMD ["node", "server.js"]
