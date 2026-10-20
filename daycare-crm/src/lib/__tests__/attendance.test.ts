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
  decideRelease,
  homeArea,
  isLockedOut,
  requestRelease,
  selfCheckIn,
  selfCheckOut,
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
  ids.ana = (await db.guardian.create({ data: { familyId: family.id, firstName: "Ana", lastName: "Lee", canPickup: true } })).id;
  ids.bob = (await db.guardian.create({ data: { familyId: family.id, firstName: "Uncle", lastName: "Bob", canPickup: false } })).id;
  ids.director = (await db.user.create({ data: { name: "Dana", email: "d@x", passwordHash: "x", role: "DIRECTOR" } })).id;
  const other = await db.family.create({ data: { name: "Other" } });
  ids.otherGuardian = (await db.guardian.create({ data: { familyId: other.id, firstName: "Zed", lastName: "Other" } })).id;
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

test("self check-in/out is limited to the guardian's own children and pickup rights", async () => {
  await assert.rejects(selfCheckIn(db, { guardianId: ids.otherGuardian, childId: ids.kid2, via: "kiosk" }), /isn't in your family/);
  await assert.rejects(selfCheckOut(db, { guardianId: ids.bob, childId: ids.kid1, via: "kiosk" }), /not on the authorized pickup list/);
  await selfCheckOut(db, { guardianId: ids.ana, childId: ids.kid1, via: "kiosk", at: t(17, 30) });
  await selfCheckIn(db, { guardianId: ids.bob, childId: ids.kid1, via: "phone", at: t(17, 40) });
  const [latest] = (await dayLog(db, dayOf(t(12)), { childId: ids.kid1 })).slice(-1);
  assert.equal(latest.droppedOffBy, "Uncle Bob");
  assert.equal(latest.checkInBy, "Self check-in (phone)");
});

test("release to someone off the list needs guardian consent and director approval", async () => {
  const teacher = { id: ids.tess, name: "Tess", role: "TEACHER" };
  const director = { id: ids.director, name: "Dana", role: "DIRECTOR" };
  const base = { childId: ids.kid2, personName: "Aunt May", relationship: "Aunt", idType: "Driver's license", idNumber: "D123-4567", consentMethod: "PHONE" };
  await assert.rejects(requestRelease(db, { ...base, consentFrom: "Uncle Bob", actor: teacher }), /authorized guardian/);
  await assert.rejects(requestRelease(db, { ...base, personName: "Ana Lee", consentFrom: "Ana Lee", actor: teacher }), /already authorized/);
  const pending = await requestRelease(db, { ...base, consentFrom: "Ana Lee", actor: teacher });
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.idLast4, "4567");
  await assert.rejects(requestRelease(db, { ...base, consentFrom: "Ana Lee", actor: teacher }), /already waiting/);
  await assert.rejects(decideRelease(db, { releaseId: pending.id, approve: true, actor: teacher }), /Only a director/);

  await decideRelease(db, { releaseId: pending.id, approve: true, actor: director, at: t(16) });
  const visit = (await dayLog(db, dayOf(t(12)), { childId: ids.kid2 }))[0];
  assert.equal(visit.pickedUpBy, "Aunt May (one-time release)");
  assert.ok(visit.checkOutAt);
  const msg = await db.message.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  assert.match(msg.body, /released .* to Aunt May .* ending 4567/);

  // A director's own request is approved and executed in one step.
  const auto = await requestRelease(db, { ...base, childId: ids.baby, consentFrom: "Ana Lee", actor: director });
  assert.equal(auto.status, "APPROVED");
  assert.equal(await db.attendance.count({ where: { childId: ids.baby, checkOutAt: null } }), 0);
});

test("denied releases don't release, and repeated failures lock out", async () => {
  await checkInChild(db, { childId: ids.kid2, droppedOffBy: "Ana Lee", at: t(17) });
  const r = await requestRelease(db, {
    childId: ids.kid2, personName: "Stranger", relationship: "Neighbor", idType: "Passport", idNumber: "X99999",
    consentFrom: "Ana Lee", consentMethod: "PHONE", actor: { id: ids.tess, name: "Tess", role: "TEACHER" },
  });
  await decideRelease(db, { releaseId: r.id, approve: false, note: "Couldn't reach parent", actor: { id: ids.director, name: "Dana", role: "DIRECTOR" } });
  await assert.rejects(checkOutChild(db, { childId: ids.kid2, pickedUpBy: "Stranger", releaseId: r.id }), /hasn't been approved/);
  assert.equal(await db.attendance.count({ where: { childId: ids.kid2, checkOutAt: null } }), 1);

  for (let i = 0; i < 5; i++) await db.auditLog.create({ data: { userId: ids.tess, action: "kiosk.pin_failed", entity: "Kiosk" } });
  assert.equal(await isLockedOut(db, ids.tess, "kiosk.pin_failed"), true);
  assert.equal(await isLockedOut(db, ids.director, "kiosk.pin_failed"), false);
});
