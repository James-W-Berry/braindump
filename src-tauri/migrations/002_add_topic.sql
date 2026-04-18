ALTER TABLE items ADD COLUMN topic TEXT;
CREATE INDEX IF NOT EXISTS idx_items_topic ON items(topic);
