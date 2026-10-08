-- CreateEnum
CREATE TYPE "ElectricityMeterStatus" AS ENUM ('ACTIVE', 'REPLACED', 'FAULTY');

-- CreateEnum
CREATE TYPE "MeterReadingKind" AS ENUM ('INITIAL', 'REGULAR', 'INTERIM');

-- CreateEnum
CREATE TYPE "ElectricityBillStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'ELECTRICITY_METER_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'ELECTRICITY_RATE_SET';
ALTER TYPE "EventType" ADD VALUE 'METER_READING_RECORDED';
ALTER TYPE "EventType" ADD VALUE 'ELECTRICITY_BILL_FINALIZED';
ALTER TYPE "EventType" ADD VALUE 'ELECTRICITY_BILL_VOIDED';

-- AlterTable
ALTER TABLE "OrgSetting" ADD COLUMN     "electricityBillingMode" TEXT NOT NULL DEFAULT 'NEXT_RENT_INVOICE',
ADD COLUMN     "electricityExcludeLeaveDays" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "electricitySplitMethod" TEXT NOT NULL DEFAULT 'DAYS_STAYED',
ADD COLUMN     "expenseApprovalThreshold" INTEGER NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "ElectricityMeter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "meterNumber" TEXT NOT NULL,
    "status" "ElectricityMeterStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedOn" TIMESTAMP(3) NOT NULL,
    "initialReading" DECIMAL(12,1) NOT NULL DEFAULT 0,
    "replacedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectricityMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectricityRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "ratePerUnit" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectricityRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "readingDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(12,1) NOT NULL,
    "kind" "MeterReadingKind" NOT NULL DEFAULT 'REGULAR',
    "photoUrl" TEXT,
    "note" TEXT,
    "takenById" TEXT,
    "takenByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomElectricityBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REGULAR',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "previousReadingId" TEXT,
    "currentReadingId" TEXT NOT NULL,
    "previousReading" DECIMAL(12,1) NOT NULL,
    "currentReading" DECIMAL(12,1) NOT NULL,
    "units" DECIMAL(12,1) NOT NULL,
    "ratePerUnit" DECIMAL(10,2) NOT NULL,
    "rateId" TEXT,
    "amount" INTEGER NOT NULL,
    "splitMethod" TEXT NOT NULL,
    "occupantCount" INTEGER NOT NULL,
    "ownerAbsorbed" BOOLEAN NOT NULL DEFAULT false,
    "uncollectedAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "ElectricityBillStatus" NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "finalizedByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomElectricityBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomElectricityShare" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "residentName" TEXT NOT NULL,
    "bedLabel" TEXT,
    "daysStayed" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "shareAmount" INTEGER NOT NULL,
    "collectible" BOOLEAN NOT NULL DEFAULT true,
    "residentChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomElectricityShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ElectricityMeter_roomId_status_idx" ON "ElectricityMeter"("roomId", "status");

-- CreateIndex
CREATE INDEX "ElectricityMeter_propertyId_idx" ON "ElectricityMeter"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectricityMeter_organizationId_meterNumber_key" ON "ElectricityMeter"("organizationId", "meterNumber");

-- CreateIndex
CREATE INDEX "ElectricityRate_propertyId_effectiveFrom_idx" ON "ElectricityRate"("propertyId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "MeterReading_organizationId_readingDate_idx" ON "MeterReading"("organizationId", "readingDate");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_meterId_readingDate_key" ON "MeterReading"("meterId", "readingDate");

-- CreateIndex
CREATE INDEX "RoomElectricityBill_organizationId_billingMonth_idx" ON "RoomElectricityBill"("organizationId", "billingMonth");

-- CreateIndex
CREATE INDEX "RoomElectricityBill_roomId_periodStart_idx" ON "RoomElectricityBill"("roomId", "periodStart");

-- CreateIndex
CREATE INDEX "RoomElectricityBill_meterId_status_idx" ON "RoomElectricityBill"("meterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomElectricityShare_residentChargeId_key" ON "RoomElectricityShare"("residentChargeId");

-- CreateIndex
CREATE INDEX "RoomElectricityShare_residentId_idx" ON "RoomElectricityShare"("residentId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomElectricityShare_billId_residentId_key" ON "RoomElectricityShare"("billId", "residentId");

-- AddForeignKey
ALTER TABLE "ElectricityMeter" ADD CONSTRAINT "ElectricityMeter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectricityMeter" ADD CONSTRAINT "ElectricityMeter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectricityMeter" ADD CONSTRAINT "ElectricityMeter_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectricityRate" ADD CONSTRAINT "ElectricityRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectricityRate" ADD CONSTRAINT "ElectricityRate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "ElectricityMeter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomElectricityBill" ADD CONSTRAINT "RoomElectricityBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomElectricityBill" ADD CONSTRAINT "RoomElectricityBill_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomElectricityBill" ADD CONSTRAINT "RoomElectricityBill_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomElectricityBill" ADD CONSTRAINT "RoomElectricityBill_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "ElectricityMeter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomElectricityShare" ADD CONSTRAINT "RoomElectricityShare_billId_fkey" FOREIGN KEY ("billId") REFERENCES "RoomElectricityBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomElectricityShare" ADD CONSTRAINT "RoomElectricityShare_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One active meter per room.
CREATE UNIQUE INDEX "ElectricityMeter_one_active_per_room" ON "ElectricityMeter"("roomId") WHERE "status" = 'ACTIVE';

-- At most one live (draft or finalized) bill per meter and reading period.
CREATE UNIQUE INDEX "RoomElectricityBill_live_period" ON "RoomElectricityBill"("meterId", "periodStart", "periodEnd") WHERE "status" <> 'VOID';

-- Carry the per-PG rate already configured on metered PGs into the rate history.
INSERT INTO "ElectricityRate" ("id", "organizationId", "propertyId", "effectiveFrom", "ratePerUnit", "note", "createdByName")
SELECT 'erate_' || p."id", p."organizationId", p."id", date_trunc('month', p."createdAt"), p."electricityRate",
       'Carried over from the PG settings', 'System'
FROM "Property" p
WHERE p."electricityMode" = 'METERED' AND p."electricityRate" > 0;

-- New permissions for the starting roles organizations already have.
UPDATE "OrgRole" SET "permissions" = "permissions" || ARRAY['electricity.view', 'electricity.readings', 'electricity.manage']::TEXT[]
WHERE "isTemplate" = true AND "name" = 'Manager' AND NOT ('electricity.view' = ANY("permissions"));
UPDATE "OrgRole" SET "permissions" = "permissions" || ARRAY['electricity.view', 'electricity.manage']::TEXT[]
WHERE "isTemplate" = true AND "name" = 'Accountant' AND NOT ('electricity.view' = ANY("permissions"));
UPDATE "OrgRole" SET "permissions" = "permissions" || ARRAY['electricity.view', 'electricity.readings']::TEXT[]
WHERE "isTemplate" = true AND "name" = 'Warden' AND NOT ('electricity.view' = ANY("permissions"));
