# Cloud Run: webhooks + scheduled reminders only (server/cloudrun.ts), bundled by deploy/cloudrun.sh
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server.mjs ./
CMD ["node", "server.mjs"]
