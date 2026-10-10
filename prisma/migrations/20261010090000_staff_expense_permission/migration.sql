-- Data only: staff-app roles created from the built-in templates may now record
-- what they buy for the PG (expenses.add, each one waits for owner approval).
-- Housekeeping also enters meter readings. Adds a key only where it is missing.
UPDATE "OrgRole"
SET "permissions" = array_append("permissions", 'expenses.add')
WHERE "app" = 'STAFF_APP'
  AND "name" IN ('Cook', 'General staff', 'Housekeeping')
  AND NOT ('expenses.add' = ANY("permissions"));

UPDATE "OrgRole"
SET "permissions" = array_append("permissions", 'electricity.readings')
WHERE "app" = 'STAFF_APP'
  AND "name" = 'Housekeeping'
  AND NOT ('electricity.readings' = ANY("permissions"));
