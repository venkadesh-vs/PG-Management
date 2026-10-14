-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "referralCode" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredByOrgId" TEXT;

-- AlterTable
ALTER TABLE "SubscriptionInvoice" ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountLabel" TEXT,
ADD COLUMN     "referralRewardId" TEXT;

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerOrgId" TEXT NOT NULL,
    "referredOrgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "discountPercent" INTEGER NOT NULL DEFAULT 50,
    "earnedAt" TIMESTAMP(3),
    "qualifyingInvoiceId" TEXT,
    "firstAppliedAt" TIMESTAMP(3),
    "windowEndsAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredOrgId_key" ON "Referral"("referredOrgId");

-- CreateIndex
CREATE INDEX "Referral_referrerOrgId_status_idx" ON "Referral"("referrerOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_referralCode_key" ON "Organization"("referralCode");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_referralRewardId_idx" ON "SubscriptionInvoice"("referralRewardId");

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_referralRewardId_fkey" FOREIGN KEY ("referralRewardId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerOrgId_fkey" FOREIGN KEY ("referrerOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredOrgId_fkey" FOREIGN KEY ("referredOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

