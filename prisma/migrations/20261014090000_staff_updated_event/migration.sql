-- Additive: activity log entry when an owner edits a staff member.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'STAFF_UPDATED';
