FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY public/ public/
COPY participants.json .

EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "src/server.js"]
