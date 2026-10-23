-- AlterTable
ALTER TABLE "Property" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RequirementRequest" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "submissionKey" TEXT,
    "clientId" TEXT,
    "requirementIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementRequest_tokenHash_key" ON "RequirementRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "RequirementRequest_ownerId_idx" ON "RequirementRequest"("ownerId");

-- AddForeignKey
ALTER TABLE "RequirementRequest" ADD CONSTRAINT "RequirementRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
