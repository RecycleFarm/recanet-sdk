# Node 22 bookworm image used for the Linux ARM64 verification on 2026-11-09.
# Multi-platform index pinned for reproducibility; only ARM64 has been executed here.
FROM node:22-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f
RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /sdk
COPY package.json package-lock.json ./
COPY tools/greenfield/package.json tools/greenfield/package-lock.json ./tools/greenfield/
RUN npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/recanet-npm-cache \
    && npm ci --prefix tools/greenfield --ignore-scripts --no-audit --no-fund --cache /tmp/recanet-npm-cache
COPY . .
RUN node --version && java -version \
    && npm run check \
    && RECANET_NPM_CACHE=/tmp/recanet-npm-cache npm run check:package
