import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  AttendanceError,
  caregiverLoads,
  checkInChild,
  checkOutChild,
  dayLog,
  homeArea,
  moveChildren,
  whereIsEveryone,
} from "@/lib/attendance";
import { dayOf } from "@/lib/dates";

let dir: string;
let db: PrismaClient;
const ids: Record<string, string> = {};
const t = (h: number, m = 0) => {
  const d = new Date(2026, 9, 21, h, m);
  return d;
};

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nestwise-att-"));
  const file = path.join(dir, "test.db");
  const sqlite = new Database(file);
  const migrations = path.join(process.cwd(), "prisma/migrations");
  for (const m of readdirSync(migrations).filter((x) => !x.endsWith(".toml")).sort()) {
    sqlite.exec(readFileSync(path.join(migrations, m, "migration.sql"), "utf8"));
  }
  sqlite.close();
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });

  const infants = await db.classroom.create({ data: { name: "Infants", ageGroup: "0-1", capacity: 8, ratio: 4 } });
  const preschool = await db.classroom.create({ data: { name: "Preschool", ageGroup: "3-4", capacity: 20, ratio: 10 } });
  ids.infants = infants.id;
  ids.preschool = preschool.id;
  ids.playground = (await db.area.create({ data: { name: "Playground" } })).id;
  const tess = await db.user.create({ data: { name: "Tess", email: "t@x", passwordHash: "x", role: "TEACHER", classroomId: preschool.id } });
  const omar = await db.user.create({ data: { name: "Omar", email: "o@x", passwordHash: "x", role: "TEACHER" } });
  ids.tess = tess.id;
  ids.omar = omar.id;
  await db.staffShift.create({ data: { userId: tess.id, classroomId: preschool.id, clockInAt: t(7) } });

  const family = await db.family.create({ data: { name: "Lee" } });
  await db.guardian.create({ data: { familyId: family.id, firstName: "Ana", lastName: "Lee", canPickup: true } });
  await db.guardian.create({ data: { familyId: family.id, firstName: "Uncle", lastName: "Bob", canPickup: false } });
  for (const [key, room] of [["kid1", preschool.id], ["kid2", preschool.id], ["baby", infants.id]] as const) {
    ids[key] = (await db.child.create({ data: { familyId: family.id, firstName: key, lastName: "Lee", dateOfBirth: new Date(2023, 0, 1), classroomId: room } })).id;
  }
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("check-in records drop-off person, home area and the caregiver on shift", async () => {
  await checkInChild(db, { childId: ids.kid1, droppedOffBy: "Ana Lee", recordedBy: "Front desk", at: t(7, 45) });
  const [here] = await whereIsEveryone(db);
  assert.equal(here.droppedOffBy, "Ana Lee");
  assert.equal(here.areaName, "Preschool");
  assert.equal(here.caregiverName, "Tess");
  await assert.rejects(checkInChild(db, { childId: ids.kid1, droppedOffBy: "Ana Lee" }), /already checked in/);
  await assert.rejects(checkInChild(db, { childId: ids.kid2, droppedOffBy: " " }), AttendanceError);
  // A caregiver who isn't clocked in can't be assigned.
  await assert.rejects(checkInChild(db, { childId: ids.kid2, droppedOffBy: "Ana Lee", caregiverId: ids.omar }), /isn't clocked in/);
});

test("group move closes the old placement and opens a new one", async () => {
  await checkInChild(db, { childId: ids.kid2, droppedOffBy: "Ana Lee", at: t(8) });
  await checkInChild(db, { childId: ids.baby, droppedOffBy: "Ana Lee", at: t(8, 5) });
  const moved = await moveChildren(db, { childIds: [ids.kid1, ids.kid2], areaId: ids.playground, at: t(10) });
  assert.equal(moved, 2);
  // Same destination again is a no-op, not a new log line.
  assert.equal(await moveChildren(db, { childIds: [ids.kid1], areaId: ids.playground, at: t(10, 1) }), 0);
  const now = await whereIsEveryone(db);
  assert.deepEqual(
    now.filter((c) => c.areaName === "Playground").map((c) => c.caregiverName),
    ["Tess", "Tess"],
  );
  await assert.rejects(moveChildren(db, { childIds: [ids.kid1] }), /Choose a new area/);
});

test("caregiver load uses the strictest ratio in the group", async () => {
  // Baby (1:4) joins Tess's preschool group (1:10) → limit becomes 4.
  await db.staffShift.create({ data: { userId: ids.omar, classroomId: ids.infants, clockInAt: t(8) } });
  await moveChildren(db, { childIds: [ids.baby], caregiverId: ids.tess, at: t(10, 30) });
  const loads = caregiverLoads(await whereIsEveryone(db));
  const tess = loads.loads.find((l) => l.caregiverName === "Tess")!;
  assert.equal(tess.children, 3);
  assert.equal(tess.limit, 4);
  assert.equal(tess.overloaded, false);
  assert.equal(
    caregiverLoads([...Array(5)].map(() => ({ caregiverId: "x", caregiverName: "X", ratio: 4 }))).loads[0].overloaded,
    true,
  );
  assert.equal(caregiverLoads([{ caregiverId: null, caregiverName: null, ratio: 4 }]).unassigned, 1);
});

test("only authorized adults can pick up; timeline is complete", async () => {
  await assert.rejects(checkOutChild(db, { childId: ids.kid1, pickedUpBy: "Uncle Bob" }), /not on the authorized pickup list/);
  await checkOutChild(db, { childId: ids.kid1, pickedUpBy: "Ana Lee", recordedBy: "Tess", at: t(16, 30) });
  // Re-check-in the same day starts a second session.
  await checkInChild(db, { childId: ids.kid1, droppedOffBy: "Ana Lee", at: t(17) });

  const log = await dayLog(db, dayOf(t(12)), { childId: ids.kid1 });
  assert.equal(log.length, 2);
  const first = log[0];
  assert.equal(first.pickedUpBy, "Ana Lee");
  assert.deepEqual(first.movements.map((m) => [m.area.name, m.caregiver?.name, m.endedAt !== null]), [
    ["Preschool", "Tess", true],
    ["Playground", "Tess", true],
  ]);
  assert.equal(log[1].checkOutAt, null);
});

test("homeArea is created once per classroom", async () => {
  const a = await homeArea(db, ids.infants);
  const b = await homeArea(db, ids.infants);
  assert.equal(a.id, b.id);
});
