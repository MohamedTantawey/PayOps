FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
