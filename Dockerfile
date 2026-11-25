FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/
RUN cd server && npm install --omit=dev

COPY client/package.json client/
RUN cd client && npm install

COPY client client
RUN cd client && npm run build

COPY server server
COPY data/karni-questions.xlsx data/karni-questions.xlsx

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/karni.sqlite \
    XLSX_PATH=/app/data/karni-questions.xlsx \
    CLIENT_DIST=/app/client/dist

EXPOSE 8080
CMD ["node", "server/src/index.js"]
