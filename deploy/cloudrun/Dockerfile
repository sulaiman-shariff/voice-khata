# Cloud Run: webhooks + scheduled reminders only (server/cloudrun.ts), bundled by deploy/cloudrun.sh
FROM node:24-slim
# ffmpeg decodes customers' WhatsApp voice notes (OGG/Opus -> 16 kHz PCM) for transcription
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY server.mjs ./
CMD ["node", "server.mjs"]
