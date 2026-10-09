-- CreateEnum
CREATE TYPE "ResidentMandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "AutopayAttemptStatus" AS ENUM ('NOTIFIED', 'INITIATED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'AUTOPAY_MANDATE_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'AUTOPAY_CHARGE';

-- AlterTable
ALTER TABLE "OrgSetting" ADD COLUMN     "autopayChargeDayOffset" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "autopayMaxAmountCap" INTEGER,
ADD COLUMN     "autopayMaxPercent" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "autopayRetryDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "residentAutopayEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ResidentMandate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "customerId" TEXT NOT NULL,
    "tokenId" TEXT,
    "authOrderId" TEXT,
    "authPaymentId" TEXT,
    "method" TEXT NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "status" "ResidentMandateStatus" NOT NULL DEFAULT 'PENDING',
    "authorizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "lastChargeAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopayAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "chargeDate" TIMESTAMP(3) NOT NULL,
    "status" "AutopayAttemptStatus" NOT NULL DEFAULT 'NOTIFIED',
    "orderId" TEXT,
    "paymentId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopayAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResidentMandate_authOrderId_key" ON "ResidentMandate"("authOrderId");

-- CreateIndex
CREATE INDEX "ResidentMandate_organizationId_status_idx" ON "ResidentMandate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ResidentMandate_residentId_status_idx" ON "ResidentMandate"("residentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayAttempt_paymentId_key" ON "AutopayAttempt"("paymentId");

-- CreateIndex
CREATE INDEX "AutopayAttempt_organizationId_status_chargeDate_idx" ON "AutopayAttempt"("organizationId", "status", "chargeDate");

-- CreateIndex
CREATE INDEX "AutopayAttempt_mandateId_idx" ON "AutopayAttempt"("mandateId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayAttempt_invoiceId_attemptNumber_key" ON "AutopayAttempt"("invoiceId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "ResidentMandate" ADD CONSTRAINT "ResidentMandate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentMandate" ADD CONSTRAINT "ResidentMandate_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopayAttempt" ADD CONSTRAINT "AutopayAttempt_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "ResidentMandate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopayAttempt" ADD CONSTRAINT "AutopayAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "RentInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one live mandate (pending, active or paused) per resident.
CREATE UNIQUE INDEX "ResidentMandate_one_live_per_resident" ON "ResidentMandate"("residentId") WHERE "status" IN ('PENDING', 'ACTIVE', 'PAUSED');
