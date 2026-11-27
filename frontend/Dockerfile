<<<<<<< HEAD
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json yarn.lock ./
COPY backend/package.json ./backend/package.json
COPY worker/package.json ./worker/package.json
COPY mock-psp/package.json ./mock-psp/package.json
COPY frontend/package.json ./frontend/package.json

RUN yarn install --frozen-lockfile --production=false

COPY frontend ./frontend
ARG VITE_MOCK_PSP_WEBHOOK_URL=http://mock-psp:4001/webhook
ENV VITE_MOCK_PSP_WEBHOOK_URL=$VITE_MOCK_PSP_WEBHOOK_URL
RUN yarn workspace @payops/frontend build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080
=======
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json yarn.lock ./
COPY backend/package.json ./backend/package.json
COPY worker/package.json ./worker/package.json
COPY mock-psp/package.json ./mock-psp/package.json
COPY frontend/package.json ./frontend/package.json

RUN yarn install --frozen-lockfile --production=false

COPY frontend ./frontend
ARG VITE_MOCK_PSP_WEBHOOK_URL=http://mock-psp:4001/webhook
ENV VITE_MOCK_PSP_WEBHOOK_URL=$VITE_MOCK_PSP_WEBHOOK_URL
RUN yarn workspace @payops/frontend build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080
>>>>>>> origin/payops-control
