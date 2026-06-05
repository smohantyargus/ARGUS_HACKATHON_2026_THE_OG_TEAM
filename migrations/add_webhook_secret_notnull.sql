-- I10.3: Backfill NULL webhook secrets and enforce NOT NULL.
-- Existing webhooks get a random placeholder secret.
-- Operators MUST rotate via POST /v1/webhooks/:id/rotate-secret after applying this.

UPDATE webhooks
SET secret = md5(random()::text || id::text || clock_timestamp()::text)
WHERE secret IS NULL;

ALTER TABLE webhooks ALTER COLUMN secret SET NOT NULL;
