-- Before this migration, a 'draft' capture was created only at process time
-- and flipped to 'processed' on success. A failed or interrupted process
-- could leave an orphaned 'draft' row. Going forward, a single 'draft' row
-- per project is the authoritative store for the user's in-progress text
-- (autosaved from the capture view and the quick-capture window). Merge any
-- pre-existing drafts into one row per project so the invariant holds.

UPDATE captures AS c
SET raw_text = (
  SELECT GROUP_CONCAT(raw_text, char(10) || char(10))
  FROM (
    SELECT raw_text FROM captures
    WHERE project_id = c.project_id AND status = 'draft'
    ORDER BY created_at ASC
  )
)
WHERE status = 'draft'
  AND id = (
    SELECT MIN(id) FROM captures
    WHERE project_id = c.project_id AND status = 'draft'
  );

DELETE FROM captures
WHERE status = 'draft'
  AND id NOT IN (
    SELECT MIN(id) FROM captures
    WHERE status = 'draft'
    GROUP BY project_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_captures_one_draft_per_project
  ON captures(project_id) WHERE status = 'draft';
