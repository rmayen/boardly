# Build the client and server, then run the API serving the built client as static files.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DB_PATH=/data/boardly.db
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json server/
RUN npm ci --omit=dev -w server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
VOLUME /data
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
