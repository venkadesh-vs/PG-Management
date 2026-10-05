-- Milestone 1: security + money fixes.
--  * Date-only columns become timestamps so IST day boundaries survive any
--    server timezone (the old DATE values were stored one day early).
--  * Invoice / receipt / complaint numbers are unique per organization.
--  * Gateway payment ids are unique, closing the webhook double-record race.
--  * Deposits are tagged so they never count as rent revenue.

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('RENT', 'DEPOSIT');

-- DropIndex
DROP INDEX "Complaint_code_key";

-- DropIndex
DROP INDEX "RentInvoice_number_key";

-- DropIndex
DROP INDEX "RentPayment_receiptNumber_key";

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "spentOn" SET DATA TYPE TIMESTAMP(3) USING ("spentOn"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "GroceryPurchase" ALTER COLUMN "purchaseDate" SET DATA TYPE TIMESTAMP(3) USING ("purchaseDate"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "Meal" ALTER COLUMN "date" SET DATA TYPE TIMESTAMP(3) USING ("date"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "OccupancySnapshot" ALTER COLUMN "date" SET DATA TYPE TIMESTAMP(3) USING ("date"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "RentInvoice" ALTER COLUMN "periodStart" SET DATA TYPE TIMESTAMP(3) USING ("periodStart"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "periodEnd" SET DATA TYPE TIMESTAMP(3) USING ("periodEnd"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "issueDate" SET DATA TYPE TIMESTAMP(3) USING ("issueDate"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMP(3) USING ("dueDate"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "RentPayment" ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'RENT';

-- AlterTable
ALTER TABLE "StaffAttendance" ALTER COLUMN "date" SET DATA TYPE TIMESTAMP(3) USING ("date"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "SubscriptionInvoice" ALTER COLUMN "periodStart" SET DATA TYPE TIMESTAMP(3) USING ("periodStart"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "periodEnd" SET DATA TYPE TIMESTAMP(3) USING ("periodEnd"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "issueDate" SET DATA TYPE TIMESTAMP(3) USING ("issueDate"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMP(3) USING ("dueDate"::timestamp + interval '18 hours 30 minutes');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UtilityCharge" ALTER COLUMN "periodStart" SET DATA TYPE TIMESTAMP(3) USING ("periodStart"::timestamp + interval '18 hours 30 minutes'),
ALTER COLUMN "periodEnd" SET DATA TYPE TIMESTAMP(3) USING ("periodEnd"::timestamp + interval '18 hours 30 minutes');

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimitHit_key_createdAt_idx" ON "RateLimitHit"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_organizationId_code_key" ON "Complaint"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RentInvoice_organizationId_number_key" ON "RentInvoice"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RentPayment_organizationId_receiptNumber_key" ON "RentPayment"("organizationId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RentPayment_gatewayPaymentId_key" ON "RentPayment"("gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_gatewayPaymentId_key" ON "SubscriptionPayment"("gatewayPaymentId");


-- Backfill: deposits recorded before the purpose column existed.
UPDATE "RentPayment" SET "purpose" = 'DEPOSIT' WHERE "notes" = 'Security deposit collected at check-in';
