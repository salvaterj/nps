FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --omit=dev

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["node", "src/server.js"]

