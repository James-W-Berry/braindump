ALTER TABLE items ADD COLUMN position REAL;

-- Seed position from created_at so existing items keep their current order.
UPDATE items
SET position = (strftime('%s', created_at) * 1.0)
WHERE position IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_position ON items(project_id, position);
