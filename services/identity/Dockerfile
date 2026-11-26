FROM node:20-alpine
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && chown -R app:app /app
USER app
ENV NODE_ENV=production
EXPOSE 3200
CMD ["sh","-c","npm run db:setup && npm start"]
