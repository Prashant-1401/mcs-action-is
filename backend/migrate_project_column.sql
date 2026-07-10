-- Rename 'project' column to 'project_name' on actions table
-- to resolve collision with the 'project' relationship (FK to projects table).
-- Safe to run multiple times (idempotent).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'actions' AND column_name = 'project'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'actions' AND column_name = 'project_name'
    ) THEN
        ALTER TABLE actions RENAME COLUMN project TO project_name;
    END IF;
END
$$;
