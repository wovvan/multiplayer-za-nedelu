FROM node:22-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER app
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]

