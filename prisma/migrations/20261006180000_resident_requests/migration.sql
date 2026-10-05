-- Resident app requests: leave, visitor pre-approval, room change, service (PRD §50).

-- CreateEnum
CREATE TYPE "ResidentRequestKind" AS ENUM ('LEAVE', 'VISITOR', 'ROOM_CHANGE', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ResidentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'DONE');

-- CreateTable
CREATE TABLE "ResidentRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "kind" "ResidentRequestKind" NOT NULL,
    "status" "ResidentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "details" TEXT,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "visitorName" TEXT,
    "visitorPhone" TEXT,
    "visitorCount" INTEGER,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResidentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResidentRequest_organizationId_status_idx" ON "ResidentRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ResidentRequest_residentId_createdAt_idx" ON "ResidentRequest"("residentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ResidentRequest" ADD CONSTRAINT "ResidentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentRequest" ADD CONSTRAINT "ResidentRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentRequest" ADD CONSTRAINT "ResidentRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

