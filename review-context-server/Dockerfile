FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "dist/server.js"]
