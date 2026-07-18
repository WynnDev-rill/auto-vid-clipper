FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev=false
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV WORK_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/index.js"]
