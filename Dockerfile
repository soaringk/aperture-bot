FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim

# Install nono sandbox (optional — falls back to unsandboxed if unavailable)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://github.com/nicholasgasior/nono/releases/latest/download/nono-linux-amd64 -o /usr/local/bin/nono \
    && chmod +x /usr/local/bin/nono \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
    || true

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist/ ./dist/

# Data directory (mount as volume for persistence)
VOLUME /app/data
ENV DATA_DIR=/app/data
ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]
CMD ["serve"]
