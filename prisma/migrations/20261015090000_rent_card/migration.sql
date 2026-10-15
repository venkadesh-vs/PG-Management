-- Additive: the PG rent card (price per sharing type, non-AC and AC).
ALTER TABLE "Property" ADD COLUMN "rentCard" JSONB;
