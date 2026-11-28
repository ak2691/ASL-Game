# The whole game in one image: the built web app plus the game server that serves it (see deploy/README.md).
# Built by GitHub Actions and pulled by the server; nothing is built on the server itself.

# 1. The web app (Vite build -> apps/web/dist).
FROM node:20-alpine AS web
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

# 2. The server's packages (production only).
FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# 3. What runs: the server, the shared game code it imports from apps/web/src, the shape model, the built app.
FROM node:20-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=deps /app/server/node_modules server/node_modules
COPY server/*.ts server/package.json server/
COPY server/db server/db
COPY apps/web/src apps/web/src
COPY apps/web/public/models/shapes.json apps/web/public/models/shapes.json
COPY --from=web /app/apps/web/dist apps/web/dist
USER node
WORKDIR /app/server
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "index.ts"]
