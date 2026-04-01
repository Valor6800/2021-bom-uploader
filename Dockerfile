FROM node:20-slim AS build

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (dev deps needed for Vite build)
RUN npm ci

# Copy source
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
COPY --from=build /app/package.json ./

USER node

EXPOSE 3000

CMD ["node", "src/server/index.js"]
