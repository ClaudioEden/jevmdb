# JevMDB: Node puro, sem dependências. Os dados (fichas, trava, buscas) ficam no volume /data.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    JEV_DADOS=/data \
    JEV_ATRAS_DE_PROXY=1
RUN mkdir -p /data/filmes && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/catalogo >/dev/null || exit 1
CMD ["node", "server.js"]
