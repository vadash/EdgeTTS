# Settings persist through a storage merge, not migrations

Saved user settings survive schema changes through the storage merge pattern. Do not add a settings migration system; the merge is the migration.
