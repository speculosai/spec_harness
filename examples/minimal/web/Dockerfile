# The web service: this example's Vite app, serving the <Builder> embed.
# Built by ../docker-compose.yml (and by the repo-root compose).

FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
