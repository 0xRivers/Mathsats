FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=8787 LISTEN_HOST=0.0.0.0 DB_PATH=/data/numbers.db
EXPOSE 8787
CMD ["node", "server/index.mjs"]
