-- Native devices register an Expo push token instead of Web Push keys. Both use the same delivery
-- pipeline, so eligibility, retries and audit behave identically on every channel.
CREATE TYPE "PushChannel" AS ENUM ('WEB_PUSH', 'EXPO');

ALTER TABLE "push_subscriptions"
  ADD COLUMN "channel" "PushChannel" NOT NULL DEFAULT 'WEB_PUSH',
  ADD COLUMN "platform" TEXT,
  ALTER COLUMN "p256dh" DROP NOT NULL,
  ALTER COLUMN "auth" DROP NOT NULL;

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_web_has_keys"
  CHECK ("channel" <> 'WEB_PUSH' OR ("p256dh" IS NOT NULL AND "auth" IS NOT NULL));

-- Expo accepts a message first and reports its fate later through a receipt.
ALTER TABLE "push_deliveries"
  ADD COLUMN "receipt_id" TEXT,
  ADD COLUMN "receipt_checked_at" TIMESTAMPTZ(3);

CREATE INDEX "push_deliveries_receipts_due_idx"
  ON "push_deliveries" ("accepted_at")
  WHERE "receipt_id" IS NOT NULL AND "receipt_checked_at" IS NULL;
