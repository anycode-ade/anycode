FROM node:22-alpine AS dependencies

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY anycode/package.json anycode/package.json
COPY anycode-base/package.json anycode-base/package.json
COPY anycode-react/package.json anycode-react/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

ARG APP_ENV=production
ENV NODE_ENV=${APP_ENV}

COPY . .

RUN pnpm --dir anycode build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/anycode/dist ./dist

EXPOSE 3000

CMD ["node", "server.js"]
