# Breachpoint: static Vite build served by nginx.
#
#   docker build -t breachpoint .
#   docker run -p 8080:80 breachpoint        # http://localhost:8080
#
# The CC0 textures, HDRIs and props (~450 MB) are not in git: the first stage downloads them with
# scripts/fetch-assets.py. That layer only depends on the script, so it stays cached between builds
# until the asset list changes.

# --- 1. Free assets (Poly Haven + three.js examples)
FROM python:3.12-alpine AS assets
WORKDIR /build
COPY scripts/fetch-assets.py scripts/fetch-assets.py
RUN python3 scripts/fetch-assets.py

# --- 2. Build the game
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Merge the downloaded assets with the ones in the repo (weapons, characters, sounds, voices)
COPY --from=assets /build/public/assets ./public/assets
RUN npm run build

# --- 3. Serve
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
