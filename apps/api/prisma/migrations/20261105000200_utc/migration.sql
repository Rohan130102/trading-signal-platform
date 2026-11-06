-- The Prisma driver sends timestamps without an offset, so PostgreSQL interprets them in the session
-- timezone. On a non-UTC server every stored instant would silently shift, while a read-back through
-- the same driver would shift it back and hide the error. The application also forces this per
-- connection; setting it here covers migrations, psql and any other client.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END $$;
