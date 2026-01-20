FROM node:18.19.1-bullseye-slim

# Install git and CA certificates
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git \
       ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone the bom-uploader repository
RUN git clone --depth 1 \
    https://git.valor6800.com/valor6800/bom-uploader.git .

# Install production dependencies
RUN npm install --production

# Drop privileges
USER node

# Expose only if the app listens on a port
EXPOSE 3000

CMD ["node", "app.js"]

