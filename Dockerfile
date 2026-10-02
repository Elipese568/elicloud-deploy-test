# syntax=docker/dockerfile:1
# elicloud-deploy-test：Node.js 22 多阶段构建。
# 注意：本项目是零运行时依赖（只用 node: 内置模块），npm ci 不会创建 node_modules，
# 所以没有独立的 deps 阶段——skill 配方里的 `COPY --from=deps /app/node_modules`
# 在零依赖项目上会报 "/app/node_modules: not found"。
# 一旦将来加了依赖，把 deps 阶段加回来（或直接在 runtime 阶段 npm ci --omit=dev）即可。

FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
# 由 workflow / deploy.sh 通过 --build-arg 注入，用于确认跑到的是哪个版本
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
