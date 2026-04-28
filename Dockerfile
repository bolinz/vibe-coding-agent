FROM oven/bun:1.3-alpine AS builder

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build src/index.ts --outdir=dist --target=bun

# Production image
FROM oven/bun:1.3-alpine

RUN apk add --no-cache \
    bash \
    tmux \
    git \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy binary
COPY --from=builder /app/dist/index.js ./index.js
COPY --from=builder /app/src/web/ui ./src/web/ui

# Create non-root user
RUN addgroup -g 1001 -S aiuser && \
    adduser -u 1001 -S aiuser -G aiuser

# Create sandbox directory
RUN mkdir -p /projects/sandbox && \
    chown -R aiuser:aiuser /projects/sandbox

USER aiuser

EXPOSE 3000

CMD ["bun", "run", "/app/index.js"]
