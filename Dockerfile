# 서버 + 웹앱을 한 컨테이너로. 배포 방법은 docs/DEPLOY.md

# 1) 웹앱 빌드
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY apps apps
COPY packages packages
RUN npm run build

# 2) 실행: 서버에 필요한 패키지만 + 빌드된 웹앱
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev -w @stock/server && npm cache clean --force
COPY packages packages
COPY apps/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist

# 계좌 DB·푸시 키·로그인 서명 키가 저장되는 곳 (볼륨으로 보관)
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://localhost:8787/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
