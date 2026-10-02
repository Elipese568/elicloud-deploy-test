# syntax=docker/dockerfile:1
# elicloud-deploy-test：零运行时依赖的 Node.js 22 多阶段构建。
# 阶段一（DEPLOY_MODE=image）会用 docker/build-push-action 直接构建本文件，
# 打上 ghcr.io/<owner>/elicloud-deploy-test:prod 与 :sha-<short> 两个 tag。

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
# 由 workflow 或 deploy.sh 通过 --build-arg / -e 注入，用于确认跑到的是哪个版本
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
