-- Add 'src_id' column to actions table to store the linked meeting id.
-- The frontend writes srcId (meeting id) / src (meeting type) when an action
-- is linked to a meeting via Quick Add or the meeting side panel.
-- Safe to run multiple times (idempotent).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'actions' AND column_name = 'src_id'
    ) THEN
        ALTER TABLE actions ADD COLUMN src_id TEXT REFERENCES meetings(id) ON UPDATE CASCADE ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_actions_src_id ON actions(src_id);
    END IF;
END
$$;
