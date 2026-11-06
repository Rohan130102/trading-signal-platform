-- Guarantees the database enforces regardless of application code.

CREATE SEQUENCE signal_event_seq AS BIGINT;
CREATE SEQUENCE trade_ref_seq AS BIGINT;

CREATE FUNCTION signal_event_hash(
  p_prev TEXT, p_id UUID, p_seq BIGINT, p_trade UUID, p_type TEXT,
  p_title TEXT, p_body TEXT, p_payload JSONB, p_at TIMESTAMPTZ
) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    p_prev, p_id::text, p_seq::text, COALESCE(p_trade::text, ''), p_type, p_title, p_body, p_payload::text,
    to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS')
  ), 'UTF8')), 'hex')
$$;

-- A plain sequence is not commit-ordered: transaction B can take a later number and commit before
-- transaction A, and a client resuming from B's number would then miss A forever. Holding this lock
-- from the moment a number is assigned until commit makes numbers commit-ordered, which is what
-- cursor-based recovery relies on. Writes are low-volume administrator actions, so serialising them
-- is cheap. The trigger makes it impossible for any writer to skip the lock.
CREATE FUNCTION signal_events_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(7200101);
  NEW.seq := nextval('signal_event_seq');
  NEW.created_at := date_trunc('milliseconds', clock_timestamp());
  SELECT hash INTO previous FROM signal_events ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := COALESCE(previous, '');
  NEW.hash := signal_event_hash(NEW.prev_hash, NEW.id, NEW.seq, NEW.trade_id, NEW.type::text,
                                NEW.title, NEW.body, NEW.payload, NEW.created_at);
  RETURN NEW;
END $$;

CREATE TRIGGER signal_events_assign BEFORE INSERT ON signal_events
  FOR EACH ROW EXECUTE FUNCTION signal_events_before_insert();

CREATE FUNCTION verify_signal_event_chain() RETURNS TABLE(checked BIGINT, first_bad_seq BIGINT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  rec RECORD;
  expected_prev TEXT := '';
  count_checked BIGINT := 0;
BEGIN
  FOR rec IN SELECT * FROM signal_events ORDER BY seq LOOP
    count_checked := count_checked + 1;
    IF rec.prev_hash <> expected_prev OR rec.hash <> signal_event_hash(
      rec.prev_hash, rec.id, rec.seq, rec.trade_id, rec.type::text, rec.title, rec.body, rec.payload, rec.created_at
    ) THEN
      checked := count_checked;
      first_bad_seq := rec.seq;
      RETURN NEXT;
      RETURN;
    END IF;
    expected_prev := rec.hash;
  END LOOP;
  checked := count_checked;
  first_bad_seq := NULL;
  RETURN NEXT;
END $$;

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER signal_events_append_only BEFORE UPDATE OR DELETE ON signal_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER signal_events_no_truncate BEFORE TRUNCATE ON signal_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER subscription_events_append_only BEFORE UPDATE OR DELETE ON subscription_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER trade_execution_records_append_only BEFORE UPDATE OR DELETE ON trade_execution_records
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A closure can only ever gain a pointer to the correction that replaced it.
CREATE FUNCTION trade_closures_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'trade_closures rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.superseded_by_event_id IS NOT NULL
     OR NEW.superseded_by_event_id IS NULL
     OR (to_jsonb(NEW) - 'superseded_by_event_id') <> (to_jsonb(OLD) - 'superseded_by_event_id') THEN
    RAISE EXCEPTION 'trade_closures rows are immutable except for superseded_by_event_id' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trade_closures_guard BEFORE UPDATE OR DELETE ON trade_closures
  FOR EACH ROW EXECUTE FUNCTION trade_closures_guard();

ALTER TABLE trades
  ADD CONSTRAINT trades_published_is_complete CHECK (
    status = 'DRAFT' OR (
      ref IS NOT NULL AND instrument_id IS NOT NULL AND instrument_spec IS NOT NULL
      AND direction IS NOT NULL AND entry_type IS NOT NULL AND entry_low IS NOT NULL
      AND entry_high IS NOT NULL AND stop_loss IS NOT NULL AND original_stop_loss IS NOT NULL
      AND published_at IS NOT NULL AND jsonb_array_length(targets) > 0
    )),
  ADD CONSTRAINT trades_entry_ordered CHECK (entry_low IS NULL OR entry_high IS NULL OR entry_low <= entry_high),
  ADD CONSTRAINT trades_prices_positive CHECK (
    (entry_low IS NULL OR entry_low > 0) AND (stop_loss IS NULL OR stop_loss > 0)
  ),
  ADD CONSTRAINT trades_fraction_bounds CHECK (closed_fraction >= 0 AND closed_fraction <= 1);

ALTER TABLE trade_closures
  ADD CONSTRAINT trade_closures_fraction_bounds CHECK (fraction > 0 AND fraction <= 1),
  ADD CONSTRAINT trade_closures_exit_positive CHECK (exit_price > 0),
  ADD CONSTRAINT trade_closures_money_needs_quantity CHECK (gross_pnl IS NULL OR quantity IS NOT NULL);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_window_valid CHECK (expires_at > starts_at);

ALTER TABLE instruments
  ADD CONSTRAINT instruments_sizes_positive CHECK (tick_size > 0 AND point_size > 0),
  ADD CONSTRAINT instruments_precision_bounds CHECK (price_precision BETWEEN 0 AND 8);

ALTER TABLE app_settings ADD CONSTRAINT app_settings_singleton CHECK (id = 1);

CREATE UNIQUE INDEX signal_templates_one_default_per_kind ON signal_templates (kind) WHERE is_default;

INSERT INTO app_settings (id, updated_at) VALUES (1, now());
