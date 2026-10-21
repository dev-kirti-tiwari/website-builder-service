FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
USER node
EXPOSE 4065
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4065/health || exit 1
# Apply migrations (idempotent, advisory-locked) then start the API.
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
