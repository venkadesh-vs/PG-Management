-- Audit event types for financial edits, roles, subscriptions, imports, support.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'PAYMENT_REVERSED';
ALTER TYPE "EventType" ADD VALUE 'PAYMENT_EDITED';
ALTER TYPE "EventType" ADD VALUE 'RENT_REVISED';
ALTER TYPE "EventType" ADD VALUE 'CHARGE_ADDED';
ALTER TYPE "EventType" ADD VALUE 'CHARGE_VOIDED';
ALTER TYPE "EventType" ADD VALUE 'INVOICE_ADJUSTED';
ALTER TYPE "EventType" ADD VALUE 'INVOICE_WAIVED';
ALTER TYPE "EventType" ADD VALUE 'EXPENSE_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'EXPENSE_VOIDED';
ALTER TYPE "EventType" ADD VALUE 'ROLE_CHANGED';
ALTER TYPE "EventType" ADD VALUE 'PERMISSION_CHANGED';
ALTER TYPE "EventType" ADD VALUE 'SUBSCRIPTION_CHANGED';
ALTER TYPE "EventType" ADD VALUE 'SUBSCRIPTION_CANCELLED';
ALTER TYPE "EventType" ADD VALUE 'IMPORT_COMPLETED';
ALTER TYPE "EventType" ADD VALUE 'SUPPORT_TICKET';
ALTER TYPE "EventType" ADD VALUE 'ADMIN_ACTION';
ALTER TYPE "EventType" ADD VALUE 'AUTH_LOGIN_FAILED';
ALTER TYPE "EventType" ADD VALUE 'SETTLEMENT_ADJUSTED';
ALTER TYPE "EventType" ADD VALUE 'MAINTENANCE_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'ASSET_UPDATED';

