-- Record when every row was created. The API orders bills by created_at
-- (with rowid as a tiebreak, because datetime('now') only has 1-second
-- resolution and several bills can land in the same second).
-- Existing rows get the migration time as their created_at.

ALTER TABLE homes ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE members ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE bills ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE shares ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
