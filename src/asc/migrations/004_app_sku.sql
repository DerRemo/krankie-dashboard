ALTER TABLE asc_apps ADD COLUMN sku TEXT;
UPDATE asc_meta SET value = '4' WHERE key = 'schema_version';
