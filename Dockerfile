FROM node:20-slim AS build

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (dev deps needed for Vite build). Playwright is a
# devDependency for the visual tests; never fetch its browsers in an image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# Copy source. See .dockerignore — .env and keys.json are excluded so no
# credential ever enters a build layer.
COPY . .

# Build the React frontend
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# --- Production image ---
FROM node:20-slim

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./

# Runtime state the app writes (the OnShape call count, cut versions' BOMs).
# Mount a volume here (e.g. `-v valorbom-data:/app/data`) to keep it across deploys.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

# Bind all interfaces *inside the container*. The container's own network is
# the boundary here, and what governs exposure is how the port is published —
# use `-p 127.0.0.1:3000:3000` so it stays off the host's external interfaces.
# Leaving the app's 127.0.0.1 default would bind container-loopback and make
# the published port unreachable.
ENV HOST=0.0.0.0
ENV PORT=3000

# /healthz is deliberately unauthenticated; it reports only liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
