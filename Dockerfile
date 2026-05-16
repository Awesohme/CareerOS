FROM node:22-slim

# Chromium for Playwright PDF generation
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libnss3 \
  libxss1 \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Persistent data directories (mount as volumes in production)
RUN mkdir -p data reports output config batch/tracker-additions

EXPOSE 4312

CMD ["node", "gui/server.mjs"]
