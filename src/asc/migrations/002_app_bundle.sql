ALTER TABLE asc_apps ADD COLUMN bundle_id TEXT;
UPDATE asc_meta SET value = '2' WHERE key = 'schema_version';
