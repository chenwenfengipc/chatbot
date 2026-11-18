# syntax=docker/dockerfile:1
# Chatbot server: docker build -t optimivas-chatbot .   (or use docker-compose.yml)

ARG NODE_VERSION=24

# ---- 1. compile TypeScript ---------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- 2. runtime image ---------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
# Bot folders (settings + knowledge). docker-compose.yml mounts ./data/bots over this,
# so you can edit knowledge without rebuilding.
COPY data ./data
# Transcripts (visitor details + chats) are written here; docker-compose.yml mounts a host folder over it.
RUN mkdir -p data/transcripts && chown node:node data/transcripts
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
