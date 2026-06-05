-- I10.3: Backfill NULL webhook secrets and enforce NOT NULL.
-- Existing webhooks get a random placeholder secret.
-- Operators MUST rotate via POST /v1/webhooks/:id/rotate-secret after applying this.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'webhooks') THEN
        UPDATE webhooks
        SET secret = md5(random()::text || id::text || clock_timestamp()::text)
        WHERE secret IS NULL;

        ALTER TABLE webhooks ALTER COLUMN secret SET NOT NULL;
    END IF;
END $$;
