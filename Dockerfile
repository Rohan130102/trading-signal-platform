# One image for api, worker and web: the command decides which runs. See docs/DEPLOYMENT.md.
FROM node:22.23-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
# Build-time values: API_ORIGIN is baked into the web app's rewrite. Leave NEXT_PUBLIC_WS_URL empty
# when the proxy serves /ws on the same origin. NODE_ENV must not be "development" here.
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_WS_URL=
ENV API_ORIGIN=$API_ORIGIN NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.23-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN useradd --system --uid 1001 signaldesk
COPY --from=build --chown=signaldesk /app /app
USER signaldesk
EXPOSE 3000 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch(process.env.HEALTH_URL||'http://localhost:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
