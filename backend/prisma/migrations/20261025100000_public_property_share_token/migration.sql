ALTER TABLE "Property" ADD COLUMN "publicShareToken" TEXT;
CREATE UNIQUE INDEX "Property_publicShareToken_key" ON "Property"("publicShareToken");
