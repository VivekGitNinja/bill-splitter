-- One member name per home. The API checks for a duplicate name before
-- inserting and answers 409; this unique index is the backstop so two
-- concurrent requests can never create the same name in the same home.
-- (SQLite cannot add a UNIQUE constraint with ALTER TABLE, so a unique
-- index enforces the same rule.)

CREATE UNIQUE INDEX uq_members_home_name ON members (home_id, name);
