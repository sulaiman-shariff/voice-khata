#!/usr/bin/env bash
# Deploy the Cloud Run side (server/cloudrun.ts): Razorpay + Vonage webhooks and the hourly reminder sweep.
# The app, the voice socket and /api/* stay on Vercel. Both use the same Neon DATABASE_URL.
#
#   bash deploy/cloudrun.sh            (from the repo root; reads .env and .env.neon.local)
#
# Lowest settings: scales to zero, one instance at most, CPU only while a request runs.
set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT=${GCLOUD_ACCOUNT:-sulaiman05221@gmail.com}
PROJECT=${GCLOUD_PROJECT:-sulaiman-projects}
REGION=asia-south1
SERVICE=voicekhata-hooks
G="--account $ACCOUNT --project $PROJECT"

set -a; . ./.env; [ -f .env.neon.local ] && . ./.env.neon.local; set +a

npx esbuild server/cloudrun.ts --bundle --platform=node --format=esm --target=node24 \
  --outfile=deploy/cloudrun/server.mjs \
  --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"

ENVFILE=$(mktemp)
trap 'rm -f "$ENVFILE"' EXIT
for k in DATABASE_URL RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET VONAGE_API_KEY VONAGE_API_SECRET \
         VONAGE_WHATSAPP_FROM VONAGE_WEBHOOK_TOKEN VONAGE_SIGNATURE_SECRET CRON_SECRET; do
  v=${!k:-}
  [ -n "$v" ] && printf '%s: "%s"\n' "$k" "$v" >> "$ENVFILE"
done
echo 'REGION: "asia-south1"' >> "$ENVFILE"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com $G
gcloud run deploy $SERVICE --source deploy/cloudrun --region $REGION $G --allow-unauthenticated \
  --cpu 1 --memory 256Mi --min-instances 0 --max-instances 1 --concurrency 20 --cpu-throttling --timeout 60 \
  --env-vars-file "$ENVFILE" --quiet

URL=$(gcloud run services describe $SERVICE --region $REGION $G --format='value(status.url)')

# hourly automatic reminders (the handler itself only sends 09:00-20:00 India time)
if gcloud scheduler jobs describe voicekhata-reminders --location $REGION $G >/dev/null 2>&1; then op=update; else op=create; fi
gcloud scheduler jobs $op http voicekhata-reminders --location $REGION $G \
  --schedule "5 * * * *" --time-zone "Asia/Kolkata" --http-method POST \
  --uri "$URL/internal/reminders-tick" --update-headers "x-cron-secret=$CRON_SECRET" 2>/dev/null \
  || gcloud scheduler jobs $op http voicekhata-reminders --location $REGION $G \
  --schedule "5 * * * *" --time-zone "Asia/Kolkata" --http-method POST \
  --uri "$URL/internal/reminders-tick" --headers "x-cron-secret=$CRON_SECRET"

echo
echo "Cloud Run: $URL"
echo "Razorpay webhook (Dashboard -> Webhooks, events payment_link.paid + payment_link.partially_paid,"
echo "  secret = RAZORPAY_WEBHOOK_SECRET from .env):  $URL/webhooks/razorpay"
echo "Vonage sandbox inbound:  $URL/webhooks/vonage/inbound?k=$VONAGE_WEBHOOK_TOKEN"
echo "Vonage sandbox status:   $URL/webhooks/vonage/status?k=$VONAGE_WEBHOOK_TOKEN"
