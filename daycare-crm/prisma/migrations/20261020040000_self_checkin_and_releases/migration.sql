-- AlterTable
ALTER TABLE "Guardian" ADD COLUMN "pinDigest" TEXT;
ALTER TABLE "Guardian" ADD COLUMN "pinSetAt" DATETIME;

-- CreateTable
CREATE TABLE "PickupRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendanceId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "idLast4" TEXT NOT NULL,
    "consentFrom" TEXT NOT NULL,
    "consentMethod" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickupRelease_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickupRelease_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickupRelease_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PickupRelease_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PickupRelease_status_idx" ON "PickupRelease"("status");

-- CreateIndex
CREATE INDEX "PickupRelease_attendanceId_idx" ON "PickupRelease"("attendanceId");

-- CreateIndex
CREATE UNIQUE INDEX "Guardian_pinDigest_key" ON "Guardian"("pinDigest");

