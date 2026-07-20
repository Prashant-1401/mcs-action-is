-- Add 'meetingid' and 'meeting_name' columns to the actions table.
-- meetingid links an action to a meeting (references meetings.id).
-- meeting_name denormalizes the meeting name for convenience/reporting.
-- Safe to run multiple times (idempotent).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'actions' AND column_name = 'meetingid'
    ) THEN
        ALTER TABLE actions ADD COLUMN meetingid TEXT REFERENCES meetings(id) ON UPDATE CASCADE ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_actions_meetingid ON actions(meetingid);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'actions' AND column_name = 'meeting_name'
    ) THEN
        ALTER TABLE actions ADD COLUMN meeting_name TEXT;
    END IF;
END
$$;
