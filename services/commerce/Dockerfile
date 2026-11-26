FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:20-alpine
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder --chown=app:app /app ./
USER app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh","-c","node scripts/setup.mjs && node prisma/seed.mjs && npm start"]
