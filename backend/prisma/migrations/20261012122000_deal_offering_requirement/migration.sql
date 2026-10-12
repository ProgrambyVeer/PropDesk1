ALTER TABLE "Deal" ADD COLUMN "offeringRequirementId" TEXT;

ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_offeringRequirementId_fkey"
  FOREIGN KEY ("offeringRequirementId") REFERENCES "Requirement"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Deal_offeringRequirementId_idx" ON "Deal"("offeringRequirementId");
