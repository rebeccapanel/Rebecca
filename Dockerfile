FROM node:20-bookworm-slim AS dashboard

WORKDIR /src/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN VITE_BASE_API=/api/ npm run build -- --outDir=build --assetsDir=statics \
    && cp ./build/index.html ./build/404.html

FROM golang:1.25-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    git \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
COPY --from=dashboard /src/dashboard/build ./dashboard/build
RUN bash scripts/build_binary.sh

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/rebecca
COPY --from=builder /src/dist/rebecca-server /usr/local/bin/rebecca-server
COPY --from=builder /src/dist/rebecca-cli /usr/local/bin/rebecca-cli
COPY templates ./templates

ENTRYPOINT ["rebecca-server"]
