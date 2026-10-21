FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY database ./database
ENV NODE_ENV=production
EXPOSE 4070
USER node
CMD ["node", "src/server.js"]
