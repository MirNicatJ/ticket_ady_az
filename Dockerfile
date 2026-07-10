FROM mcr.microsoft.com/playwright:v1.56.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY config.json ./
COPY src ./src

ENV HEADLESS=true
ENV STATE_FILE=/data/state.json

CMD ["npm", "start"]
