FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --include=optional
COPY . .
CMD ["node", "src/server.js"]
