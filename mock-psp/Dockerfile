FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
COPY backend/package.json ./backend/package.json
COPY worker/package.json ./worker/package.json
COPY mock-psp/package.json ./mock-psp/package.json
COPY frontend/package.json ./frontend/package.json

RUN yarn install --frozen-lockfile --production

COPY mock-psp ./mock-psp

ENV NODE_ENV=production
ENV MOCK_PSP_PORT=4001
ENV MOCK_PAYMO_PORT=4002

EXPOSE 4001 4002

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "mock-psp/src/server.js"]