-- The resident due-day window applies to every resident, with or without AutoPay.
ALTER TABLE "OrgSetting" RENAME COLUMN "autopayDayMin" TO "rentDueDayMin";
ALTER TABLE "OrgSetting" RENAME COLUMN "autopayDayMax" TO "rentDueDayMax";
