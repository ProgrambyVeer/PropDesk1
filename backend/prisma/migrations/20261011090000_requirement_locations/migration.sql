ALTER TABLE "Requirement"
ADD COLUMN "locations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Requirement"
SET "locations" = ARRAY["location"]::TEXT[]
WHERE cardinality("locations") = 0;