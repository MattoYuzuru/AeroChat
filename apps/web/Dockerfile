FROM node:22-alpine AS builder

WORKDIR /workspace

RUN npm install -g pnpm@10.19.0

COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web

RUN pnpm --filter @aerochat/web build

FROM nginx:1.29-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html
