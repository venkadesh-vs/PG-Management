-- Dynamic roles, owner-controlled modules and editable lookups.
-- Default roles and lookup values per organization are created by
-- src/server/services/org-defaults.ts (on first use and at sign-up).

-- CreateEnum
CREATE TYPE "RoleApp" AS ENUM ('DASHBOARD', 'STAFF_APP');

-- AlterTable
-- Keep every existing category: the enum value becomes the lookup value.
ALTER TABLE "Complaint" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;

-- AlterTable
ALTER TABLE "OrgSetting" ADD COLUMN     "disabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
-- Keep every existing staff role the same way.
ALTER TABLE "Staff" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "orgRoleId" TEXT;

-- CreateTable
CREATE TABLE "OrgRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "app" "RoleApp" NOT NULL DEFAULT 'DASHBOARD',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgLookup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgRole_organizationId_name_key" ON "OrgRole"("organizationId", "name");

-- CreateIndex
CREATE INDEX "OrgLookup_organizationId_type_active_idx" ON "OrgLookup"("organizationId", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "OrgLookup_organizationId_type_value_key" ON "OrgLookup"("organizationId", "type", "value");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgRoleId_fkey" FOREIGN KEY ("orgRoleId") REFERENCES "OrgRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRole" ADD CONSTRAINT "OrgRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgLookup" ADD CONSTRAINT "OrgLookup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

