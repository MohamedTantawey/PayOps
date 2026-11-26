FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
COPY backend/package.json ./backend/package.json
COPY worker/package.json ./worker/package.json
COPY mock-psp/package.json ./mock-psp/package.json
COPY frontend/package.json ./frontend/package.json

RUN yarn install --frozen-lockfile --production

COPY backend ./backend
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/src/server.js"]

