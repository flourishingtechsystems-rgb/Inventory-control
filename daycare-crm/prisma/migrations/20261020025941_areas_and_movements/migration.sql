-- DropIndex
DROP INDEX "Attendance_childId_day_key";

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "droppedOffBy" TEXT;

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "classroomId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Area_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChildMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendanceId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "caregiverId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "recordedBy" TEXT,
    CONSTRAINT "ChildMovement_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChildMovement_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChildMovement_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChildMovement_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Area_classroomId_key" ON "Area"("classroomId");

-- CreateIndex
CREATE INDEX "ChildMovement_childId_startedAt_idx" ON "ChildMovement"("childId", "startedAt");

-- CreateIndex
CREATE INDEX "ChildMovement_areaId_endedAt_idx" ON "ChildMovement"("areaId", "endedAt");

-- CreateIndex
CREATE INDEX "ChildMovement_caregiverId_endedAt_idx" ON "ChildMovement"("caregiverId", "endedAt");

-- CreateIndex
CREATE INDEX "Attendance_childId_day_idx" ON "Attendance"("childId", "day");

-- Backfill: every classroom gets a home area, and existing attendance sessions
-- get a movement in that area so history and "where is everyone" stay complete.
INSERT INTO "Area" ("id", "name", "classroomId", "active", "createdAt")
SELECT 'area_' || "id", "name", "id", true, "createdAt" FROM "Classroom";

INSERT INTO "ChildMovement" ("id", "attendanceId", "childId", "areaId", "startedAt", "endedAt", "recordedBy")
SELECT 'mv_' || "id", "id", "childId", 'area_' || "classroomId", "checkInAt", "checkOutAt", "checkInBy" FROM "Attendance";
