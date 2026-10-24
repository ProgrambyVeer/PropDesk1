-- At most one active (not CLOSED/LOST, not deleted) deal per requirement + property.
-- Fails loudly if existing data already contains duplicates; resolve them before deploying.
CREATE UNIQUE INDEX "Deal_active_requirement_property_key"
  ON "Deal" ("requirementId", "propertyId")
  WHERE "deletedAt" IS NULL AND "stage" NOT IN ('CLOSED', 'LOST');
