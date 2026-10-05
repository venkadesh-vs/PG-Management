-- Resident enquiry CRM, bed bookings with token, complaint SLA, deposit refund
-- details and an index of uploaded files (PRD §30, §32, §35, §43, §79).

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WALK_IN', 'PHONE', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'PORTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ResidentLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'VISITED', 'INTERESTED', 'TOKEN_PAID', 'BOOKED', 'CHECKED_IN', 'LOST');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'CHECKED_IN');

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "slaBreachedAt" TIMESTAMP(3),
ADD COLUMN     "slaDueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrgSetting" ADD COLUMN     "slaHighHours" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "slaLowHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "slaMediumHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "slaUrgentHours" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "SecurityDeposit" ADD COLUMN     "refundNote" TEXT,
ADD COLUMN     "refundReference" TEXT;

-- CreateTable
CREATE TABLE "ResidentLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "gender" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'PHONE',
    "status" "ResidentLeadStatus" NOT NULL DEFAULT 'NEW',
    "budget" INTEGER,
    "roomTypePref" TEXT,
    "moveInDate" TIMESTAMP(3),
    "visitAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "notes" TEXT,
    "assignedToId" TEXT,
    "residentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentLeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidentLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leadId" TEXT,
    "bedId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "checkInDate" TIMESTAMP(3) NOT NULL,
    "rent" INTEGER NOT NULL,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "tokenAmount" INTEGER NOT NULL DEFAULT 0,
    "tokenPaidAt" TIMESTAMP(3),
    "tokenMethod" TEXT,
    "tokenReference" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "residentId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "residentId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResidentLead_residentId_key" ON "ResidentLead"("residentId");

-- CreateIndex
CREATE INDEX "ResidentLead_organizationId_status_idx" ON "ResidentLead"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ResidentLead_organizationId_nextFollowUpAt_idx" ON "ResidentLead"("organizationId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "ResidentLead_phone_idx" ON "ResidentLead"("phone");

-- CreateIndex
CREATE INDEX "ResidentLeadActivity_leadId_createdAt_idx" ON "ResidentLeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_residentId_key" ON "Booking"("residentId");

-- CreateIndex
CREATE INDEX "Booking_organizationId_status_idx" ON "Booking"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Booking_bedId_status_idx" ON "Booking"("bedId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_organizationId_code_key" ON "Booking"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_key_key" ON "UploadedFile"("key");

-- CreateIndex
CREATE INDEX "UploadedFile_organizationId_purpose_idx" ON "UploadedFile"("organizationId", "purpose");

-- AddForeignKey
ALTER TABLE "ResidentLead" ADD CONSTRAINT "ResidentLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentLead" ADD CONSTRAINT "ResidentLead_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentLeadActivity" ADD CONSTRAINT "ResidentLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ResidentLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ResidentLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

