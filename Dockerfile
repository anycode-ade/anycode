FROM node:22-alpine AS dependencies

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY anycode/package.json anycode/package.json
COPY anycode-agent/package.json anycode-agent/package.json
COPY anycode-editor/core/package.json anycode-editor/core/package.json
COPY anycode-editor/react/package.json anycode-editor/react/package.json

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
