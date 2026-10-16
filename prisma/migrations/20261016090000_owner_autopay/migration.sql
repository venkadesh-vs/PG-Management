-- Additive: one AutoPay per owner for the combined StayFlow bill.
CREATE TABLE "OwnerMandate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "customerId" TEXT NOT NULL DEFAULT '',
    "tokenId" TEXT,
    "authOrderId" TEXT,
    "authPaymentId" TEXT,
    "method" TEXT NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "status" "ResidentMandateStatus" NOT NULL DEFAULT 'PENDING',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "authorizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "lastChargeAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnerMandate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnerAutopayAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
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
    CONSTRAINT "OwnerAutopayAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerMandate_authOrderId_key" ON "OwnerMandate"("authOrderId");
CREATE INDEX "OwnerMandate_organizationId_status_idx" ON "OwnerMandate"("organizationId", "status");
CREATE UNIQUE INDEX "OwnerAutopayAttempt_paymentId_key" ON "OwnerAutopayAttempt"("paymentId");
CREATE UNIQUE INDEX "OwnerAutopayAttempt_organizationId_dueDate_attemptNumber_key" ON "OwnerAutopayAttempt"("organizationId", "dueDate", "attemptNumber");
CREATE INDEX "OwnerAutopayAttempt_status_chargeDate_idx" ON "OwnerAutopayAttempt"("status", "chargeDate");
CREATE INDEX "OwnerAutopayAttempt_mandateId_idx" ON "OwnerAutopayAttempt"("mandateId");

ALTER TABLE "OwnerMandate" ADD CONSTRAINT "OwnerMandate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerAutopayAttempt" ADD CONSTRAINT "OwnerAutopayAttempt_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "OwnerMandate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
