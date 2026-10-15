-- Additive: one combined StayFlow bill per owner (due day 1-10), late fee,
-- and referral credit as a balance.
ALTER TABLE "OrgSetting" ADD COLUMN "billingDueDay" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Organization" ADD COLUMN "referralCredit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "alignedFrom" TIMESTAMP(3);
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "lateFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "lateFeeAt" TIMESTAMP(3);
ALTER TABLE "Referral" ADD COLUMN "creditAmount" INTEGER;
