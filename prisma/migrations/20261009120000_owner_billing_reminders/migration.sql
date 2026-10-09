-- AlterTable
ALTER TABLE "OrgSetting" ADD COLUMN     "ownerBillingChannels" TEXT[] DEFAULT ARRAY['WHATSAPP', 'EMAIL']::TEXT[];

-- CreateTable
CREATE TABLE "OwnerBillingReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channels" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerBillingReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPaymentClaim" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "utr" TEXT NOT NULL,
    "proofUrl" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerBillingReminder_key_key" ON "OwnerBillingReminder"("key");

-- CreateIndex
CREATE INDEX "OwnerBillingReminder_organizationId_sentAt_idx" ON "OwnerBillingReminder"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentClaim_status_createdAt_idx" ON "SubscriptionPaymentClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentClaim_organizationId_createdAt_idx" ON "SubscriptionPaymentClaim"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "OwnerBillingReminder" ADD CONSTRAINT "OwnerBillingReminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentClaim" ADD CONSTRAINT "SubscriptionPaymentClaim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
