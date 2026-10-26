FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

CMD ["npx", "--yes", "wrangler@4.152.0", "dev", "--ip", "0.0.0.0", "--port", "8787"]
