-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUBSCRIBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ACTIVE', 'PARTIALLY_CLOSED', 'CLOSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('SINGLE', 'RANGE');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'PRIORITY');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SIGNAL_PUBLISHED', 'ENTRY_ACTIVATED', 'EXECUTION_RECORDED', 'STOP_MOVED', 'TARGET_HIT', 'TARGETS_MODIFIED', 'PARTIAL_BOOKED', 'TRADE_CLOSED', 'TRADE_CANCELLED', 'ENTRY_EXPIRED', 'URGENT_INSTRUCTION', 'CORRECTION', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "CalculationBasis" AS ENUM ('NONE', 'HYPOTHETICAL_OUTCOME', 'ADMIN_DECLARED_EXECUTION', 'EXTERNALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "ClosureKind" AS ENUM ('PARTIAL', 'FINAL');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('TARGET_ACHIEVED', 'STOP_LOSS_HIT', 'MANUAL', 'BREAKEVEN', 'INVALIDATED', 'OTHER');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENDING', 'RETRY', 'ACCEPTED', 'FAILED', 'GONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('CREATED', 'RENEWED', 'ADJUSTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "login_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "temp_password_expires_at" TIMESTAMPTZ(3),
    "mfa_secret_enc" TEXT,
    "mfa_enabled_at" TIMESTAMPTZ(3),
    "mfa_last_step" BIGINT,
    "last_login_at" TIMESTAMPTZ(3),
    "last_read_seq" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "device_label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "mode" TEXT,
    "duration_days" INTEGER,
    "previous_starts_at" TIMESTAMPTZ(3),
    "previous_expires_at" TIMESTAMPTZ(3),
    "new_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "new_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "actor_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "asset_class" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "price_precision" INTEGER NOT NULL,
    "tick_size" DECIMAL(24,8) NOT NULL,
    "point_size" DECIMAL(24,8) NOT NULL,
    "default_target_points" DECIMAL(24,8) NOT NULL,
    "default_stop_points" DECIMAL(24,8) NOT NULL,
    "default_target2_points" DECIMAL(24,8),
    "default_target3_points" DECIMAL(24,8),
    "contract_multiplier" DECIMAL(24,8),
    "unit_label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_templates" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" UUID NOT NULL,
    "ref" TEXT,
    "status" "TradeStatus" NOT NULL DEFAULT 'DRAFT',
    "instrument_id" UUID,
    "instrument_spec" JSONB,
    "direction" "Direction",
    "entry_type" "EntryType",
    "entry_low" DECIMAL(24,8),
    "entry_high" DECIMAL(24,8),
    "original_stop_loss" DECIMAL(24,8),
    "stop_loss" DECIMAL(24,8),
    "targets" JSONB NOT NULL DEFAULT '[]',
    "closed_fraction" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "closure_basis" "CalculationBasis",
    "execution_entry" DECIMAL(24,8),
    "execution_quantity" DECIMAL(24,8),
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "commentary" TEXT,
    "template_id" UUID,
    "used_default_levels" BOOLEAN,
    "version" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB,
    "entry_expires_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_events" (
    "id" UUID NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "trade_id" UUID,
    "trade_version" INTEGER,
    "type" "EventType" NOT NULL,
    "broadcast" BOOLEAN NOT NULL DEFAULT true,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "tone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "template_id" UUID,
    "actor_id" UUID,
    "idempotency_key" TEXT,
    "prev_hash" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "signal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_execution_records" (
    "id" UUID NOT NULL,
    "trade_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "basis" "CalculationBasis" NOT NULL,
    "entry_price" DECIMAL(24,8) NOT NULL,
    "quantity" DECIMAL(24,8),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_execution_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_closures" (
    "id" UUID NOT NULL,
    "trade_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "ClosureKind" NOT NULL,
    "fraction" DECIMAL(24,12) NOT NULL,
    "quantity" DECIMAL(24,8),
    "exit_price" DECIMAL(24,8) NOT NULL,
    "exited_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" "CloseReason",
    "basis" "CalculationBasis" NOT NULL,
    "entry_price_used" DECIMAL(24,8),
    "multiplier_used" DECIMAL(24,8),
    "fees" DECIMAL(24,8),
    "price_move" DECIMAL(24,8),
    "points" DECIMAL(24,8),
    "gross_pnl" DECIMAL(28,8),
    "net_pnl" DECIMAL(28,8),
    "methodology_version" TEXT NOT NULL,
    "supersedes_id" UUID,
    "superseded_by_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "processed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device_label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_accepted_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "push_subscription_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "push_new_signals" BOOLEAN NOT NULL DEFAULT true,
    "push_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_closures" BOOLEAN NOT NULL DEFAULT true,
    "push_announcements" BOOLEAN NOT NULL DEFAULT true,
    "hide_preview" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "service_name" TEXT NOT NULL DEFAULT 'SignalDesk',
    "business_timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "support_contact" TEXT NOT NULL DEFAULT '',
    "renewal_instructions" TEXT NOT NULL DEFAULT '',
    "legal_entity_name" TEXT NOT NULL DEFAULT '',
    "regulatory_statement" TEXT NOT NULL DEFAULT '',
    "risk_disclosure" TEXT NOT NULL DEFAULT '',
    "privacy_notice" TEXT NOT NULL DEFAULT '',
    "service_description" TEXT NOT NULL DEFAULT '',
    "entry_expiry_hours_default" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_performance_approvals" (
    "id" UUID NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "document_reference" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_performance_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

-- CreateTable
CREATE TABLE "fanout_metrics" (
    "id" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "instance_id" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fanout_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_expires_at_idx" ON "subscriptions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_events_idempotency_key_key" ON "subscription_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_created_at_idx" ON "subscription_events"("subscription_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_symbol_key" ON "instruments"("symbol");

-- CreateIndex
CREATE INDEX "instruments_active_sort_order_idx" ON "instruments"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "signal_templates_kind_name_key" ON "signal_templates"("kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "trades_ref_key" ON "trades"("ref");

-- CreateIndex
CREATE INDEX "trades_status_published_at_idx" ON "trades"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "trades_instrument_id_published_at_idx" ON "trades"("instrument_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "trades_entry_expires_at_idx" ON "trades"("entry_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "signal_events_seq_key" ON "signal_events"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "signal_events_idempotency_key_key" ON "signal_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "signal_events_broadcast_seq_idx" ON "signal_events"("broadcast", "seq" DESC);

-- CreateIndex
CREATE INDEX "signal_events_trade_id_seq_idx" ON "signal_events"("trade_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "signal_events_trade_id_trade_version_key" ON "signal_events"("trade_id", "trade_version");

-- CreateIndex
CREATE INDEX "trade_execution_records_trade_id_idx" ON "trade_execution_records"("trade_id");

-- CreateIndex
CREATE INDEX "trade_closures_trade_id_created_at_idx" ON "trade_closures"("trade_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "push_deliveries_status_next_attempt_at_idx" ON "push_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_deliveries_event_id_push_subscription_id_key" ON "push_deliveries"("event_id", "push_subscription_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_target_id_idx" ON "audit_logs"("target_id");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "rate_limit_buckets"("window_start");

-- CreateIndex
CREATE INDEX "fanout_metrics_created_at_idx" ON "fanout_metrics"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fanout_metrics_event_id_instance_id_key" ON "fanout_metrics"("event_id", "instance_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "signal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "signal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_execution_records" ADD CONSTRAINT "trade_execution_records_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_execution_records" ADD CONSTRAINT "trade_execution_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signal_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_execution_records" ADD CONSTRAINT "trade_execution_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_closures" ADD CONSTRAINT "trade_closures_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_closures" ADD CONSTRAINT "trade_closures_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signal_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_closures" ADD CONSTRAINT "trade_closures_superseded_by_event_id_fkey" FOREIGN KEY ("superseded_by_event_id") REFERENCES "signal_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signal_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signal_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_push_subscription_id_fkey" FOREIGN KEY ("push_subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_performance_approvals" ADD CONSTRAINT "public_performance_approvals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fanout_metrics" ADD CONSTRAINT "fanout_metrics_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "signal_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

