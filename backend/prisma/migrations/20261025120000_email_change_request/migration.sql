CREATE TABLE "EmailChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentEmail" TEXT,
    "newEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailChangeRequest_userId_status_idx" ON "EmailChangeRequest"("userId", "status");
CREATE INDEX "EmailChangeRequest_status_createdAt_idx" ON "EmailChangeRequest"("status", "createdAt");
-- At most one pending request per user
CREATE UNIQUE INDEX "EmailChangeRequest_one_pending" ON "EmailChangeRequest"("userId") WHERE "status" = 'PENDING';

ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT "EmailChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
