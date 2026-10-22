FROM ghcr.io/home-assistant/aarch64-base:latest

# Só o essencial: Node + Chromium (o Puppeteer do whatsapp-web.js precisa dele).
RUN apk add --no-cache \
    nodejs \
    npm \
    chromium \
    tzdata

ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production

# O puppeteer (dependência do whatsapp-web.js) baixaria o próprio Chromium (~200MB)
# durante o npm install. Como usamos o Chromium do sistema (apk acima), pulamos esse
# download redundante — é o que mais pesa no tempo de build.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /share/bot_noticias

EXPOSE 8090

COPY run.sh /
RUN chmod +x /run.sh

CMD [ "/run.sh" ]
