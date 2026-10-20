import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_CHART } from "../src/lib/accounting/accounts";
import { systemAccounts } from "../src/lib/accounting/posting";
import { postBillingRun } from "../src/lib/accounting/billing-run";
import { createAdjustment, createDeposit, createInvoice, recordPayment } from "../src/lib/accounting/receivables";
import { addDays, monthPeriod, today } from "../src/lib/dates";
import { checkInChild, checkOutChild, homeArea, moveChildren } from "../src/lib/attendance";
import { pinDigest } from "../src/lib/presence";
import type { Role } from "../src/lib/roles";

const DEMO_PASSWORD = "password123";

async function main() {
  if (await prisma.center.findUnique({ where: { id: "center" } })) {
    console.log("Database already seeded — delete dev.db and re-run migrate + seed to start over.");
    return;
  }

  await prisma.center.create({
    data: {
      name: "Little Acorns Early Learning",
      legalName: "Little Acorns Early Learning LLC",
      ein: "84-1234567",
      address: "120 Oak Street, Springfield, IL 62701",
      phone: "(217) 555-0142",
      email: "hello@littleacorns.example",
      invoiceDueDays: 7,
      lateFeeCents: 2500,
      lateFeeGraceDays: 5,
      siblingDiscountBps: 1000,
    },
  });
  for (const account of DEFAULT_CHART) await prisma.account.create({ data: account });
  const accounts = await systemAccounts(prisma);

  const rooms = {
    infants: await prisma.classroom.create({ data: { name: "Acorns (Infants)", ageGroup: "6 wks – 12 mo", capacity: 8, ratio: 4 } }),
    toddlers: await prisma.classroom.create({ data: { name: "Saplings (Toddlers)", ageGroup: "1 – 2 yrs", capacity: 12, ratio: 6 } }),
    preschool: await prisma.classroom.create({ data: { name: "Oaks (Preschool)", ageGroup: "3 – 4 yrs", capacity: 20, ratio: 10 } }),
  };

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = (name: string, email: string, role: Role, extra: { classroomId?: string; guardianId?: string } = {}) =>
    prisma.user.create({ data: { name, email, role, passwordHash: hash, ...extra } });
  const admin = await user("Avery Admin", "admin@demo.com", "ADMIN");
  const director = await user("Dana Director", "director@demo.com", "DIRECTOR");
  await user("Blake Bookkeeper", "books@demo.com", "BOOKKEEPER");
  const teacher = await user("Tess Teacher", "teacher@demo.com", "TEACHER", { classroomId: rooms.toddlers.id });
  await user("Omar Teacher", "omar@demo.com", "TEACHER", { classroomId: rooms.preschool.id });

  const plans = {
    infant: await prisma.feePlan.create({ data: { name: "Infant Full-Time", amountCents: 165000, frequency: "MONTHLY", revenueAccountId: accounts.TUITION, classroomId: rooms.infants.id } }),
    toddler: await prisma.feePlan.create({ data: { name: "Toddler Full-Time", amountCents: 145000, frequency: "MONTHLY", revenueAccountId: accounts.TUITION, classroomId: rooms.toddlers.id } }),
    preschool: await prisma.feePlan.create({ data: { name: "Preschool Full-Time", amountCents: 120000, frequency: "MONTHLY", revenueAccountId: accounts.TUITION, classroomId: rooms.preschool.id } }),
    preschoolPart: await prisma.feePlan.create({ data: { name: "Preschool 3-Day", amountCents: 82000, frequency: "MONTHLY", revenueAccountId: accounts.TUITION, classroomId: rooms.preschool.id } }),
  };

  const county = await prisma.payer.create({
    data: { name: "Sangamon County CCAP", kind: "AGENCY", email: "ccap@county.example" },
  });

  const now = today();
  const thisMonth = monthPeriod(now);
  const lastMonth = monthPeriod(addDays(thisMonth.start, -1));

  type Kid = { first: string; dob: string; room: keyof typeof rooms; plan: keyof typeof plans; start?: Date };
  async function family(
    name: string,
    guardians: { first: string; last: string; email: string; rel: string }[],
    kids: Kid[],
    opts: { autopay?: boolean; split?: "coparent" | "subsidy"; discount?: { bps: number; reason: string } } = {},
  ) {
    const fam = await prisma.family.create({ data: { name } });
    const payers = [];
    for (const [i, g] of guardians.entries()) {
      const guardian = await prisma.guardian.create({
        data: { familyId: fam.id, firstName: g.first, lastName: g.last, email: g.email, phone: `(217) 555-01${10 + i}`, relationship: g.rel, isPrimary: i === 0 },
      });
      payers.push(
        await prisma.payer.create({
          data: {
            name: `${g.first} ${g.last}`,
            kind: "GUARDIAN",
            email: g.email,
            familyId: fam.id,
            guardianId: guardian.id,
            autopay: Boolean(opts.autopay),
            paymentMethodLabel: opts.autopay ? "Visa •••• 4242" : null,
          },
        }),
      );
    }
    for (const kid of kids) {
      const lastName = guardians[0].last;
      const child = await prisma.child.create({
        data: {
          familyId: fam.id,
          firstName: kid.first,
          lastName,
          dateOfBirth: new Date(kid.dob),
          classroomId: rooms[kid.room].id,
          allergies: kid.first === "Leo" ? "Peanuts (EpiPen in office)" : null,
          immunizationsDue: kid.first === "Mia" ? addDays(now, 12) : null,
        },
      });
      const enrollment = await prisma.enrollment.create({
        data: {
          childId: child.id,
          feePlanId: plans[kid.plan].id,
          startDate: kid.start ?? new Date("2026-01-05"),
          discountBps: opts.discount?.bps ?? 0,
          discountReason: opts.discount?.reason ?? null,
        },
      });
      if (opts.split === "coparent" && payers.length > 1) {
        await prisma.billingSplit.createMany({
          data: [
            { enrollmentId: enrollment.id, payerId: payers[0].id, kind: "PERCENT", value: 6000 },
            { enrollmentId: enrollment.id, payerId: payers[1].id, kind: "PERCENT", value: 4000 },
          ],
        });
      }
      if (opts.split === "subsidy") {
        await prisma.billingSplit.create({ data: { enrollmentId: enrollment.id, payerId: county.id, kind: "FIXED", value: 95000 } });
      }
    }
    return { fam, payers };
  }

  const garcia = await family(
    "Garcia Family",
    [{ first: "Maria", last: "Garcia", email: "parent@demo.com", rel: "Mother" }, { first: "Luis", last: "Garcia", email: "luis@example.com", rel: "Father" }],
    [{ first: "Sofia", dob: "2022-04-11", room: "preschool", plan: "preschool" }, { first: "Mateo", dob: "2025-01-20", room: "toddlers", plan: "toddler" }],
    { autopay: true },
  );
  const chen = await family(
    "Chen / Park Family",
    [{ first: "Wei", last: "Chen", email: "wei.chen@example.com", rel: "Mother" }, { first: "Daniel", last: "Park", email: "d.park@example.com", rel: "Father" }],
    [{ first: "Leo", dob: "2023-02-02", room: "preschool", plan: "preschool" }],
    { split: "coparent" },
  );
  const johnson = await family(
    "Johnson Family",
    [{ first: "Keisha", last: "Johnson", email: "keisha.j@example.com", rel: "Mother" }],
    [{ first: "Mia", dob: "2025-06-15", room: "infants", plan: "infant" }],
    { split: "subsidy" },
  );
  const obrien = await family(
    "O'Brien Family",
    [{ first: "Sean", last: "O'Brien", email: "sean.ob@example.com", rel: "Father" }],
    [{ first: "Nora", dob: "2022-09-30", room: "preschool", plan: "preschoolPart" }],
    { discount: { bps: 1500, reason: "Staff discount" } },
  );
  const patel = await family(
    "Patel Family",
    [{ first: "Priya", last: "Patel", email: "priya.p@example.com", rel: "Mother" }],
    [{ first: "Arjun", dob: "2024-08-08", room: "toddlers", plan: "toddler", start: addDays(thisMonth.start, 14) }],
  );
  const nguyen = await family(
    "Nguyen Family",
    [{ first: "Thanh", last: "Nguyen", email: "thanh.n@example.com", rel: "Mother" }],
    [{ first: "Emma", dob: "2025-11-02", room: "infants", plan: "infant" }],
  );

  const garciaUser = await prisma.guardian.findFirstOrThrow({ where: { email: "parent@demo.com" } });
  await user("Maria Garcia", "parent@demo.com", "PARENT", { guardianId: garciaUser.id });

  // Last month: bill, collect, deposit.
  await prisma.$transaction(
    async (tx) => {
      await postBillingRun(tx, "MONTHLY", lastMonth.start, { issueDate: lastMonth.start, userId: admin.id });
      await createInvoice(tx, {
        payerId: patel.payers[0].id,
        issueDate: addDays(lastMonth.start, 20),
        lines: [{ description: "Registration fee – Arjun", accountId: accounts.REGISTRATION, amountCents: 15000 }],
        userId: admin.id,
      });
      const pay = async (payerId: string, cents: number, method: "CARD" | "ACH" | "CHECK" | "SUBSIDY", day: number, reference?: string) =>
        recordPayment(tx, { payerId, amountCents: cents, method, receivedAt: addDays(lastMonth.start, day), reference, userId: admin.id });
      const p1 = await pay(garcia.payers[0].id, 120000 + 145000 - 12000, "CARD", 1, "Autopay");
      const p2 = await pay(chen.payers[0].id, 72000, "ACH", 3);
      const p3 = await pay(chen.payers[1].id, 48000, "ACH", 4);
      const p4 = await pay(johnson.payers[0].id, 70000, "CHECK", 6, "Check #2214");
      const p5 = await pay(obrien.payers[0].id, 69700, "CARD", 2);
      const p6 = await pay(patel.payers[0].id, 15000, "CARD", 21);
      const p7 = await pay(county.id, 90000, "SUBSIDY", 25, "CCAP remit 0925");
      await pay(nguyen.payers[0].id, 100000, "CARD", 9);
      await createAdjustment(tx, {
        payerId: county.id,
        kind: "WRITE_OFF",
        amountCents: 5000,
        reason: "CCAP absent-day reduction",
        date: addDays(lastMonth.start, 25),
        userId: admin.id,
      });
      await createDeposit(tx, { paymentIds: [p1.id, p5.id], date: addDays(lastMonth.start, 4), reference: "Stripe payout po_1Q9" });
      await createDeposit(tx, { paymentIds: [p2.id, p3.id, p4.id], date: addDays(lastMonth.start, 8), reference: "Bank deposit" });
      await createDeposit(tx, { paymentIds: [p6.id, p7.id], date: addDays(lastMonth.start, 27), reference: "Payout + CCAP" });

      // This month: bill everyone; a few have paid so far.
      await postBillingRun(tx, "MONTHLY", thisMonth.start, { issueDate: thisMonth.start, userId: admin.id });
      if (now.getUTCDate() > 2) {
        await recordPayment(tx, {
          payerId: garcia.payers[0].id,
          amountCents: 120000 + 145000 - 12000,
          method: "CARD",
          receivedAt: addDays(thisMonth.start, 1),
          reference: "Autopay",
          userId: admin.id,
        });
        await recordPayment(tx, { payerId: chen.payers[0].id, amountCents: 72000, method: "ACH", receivedAt: addDays(thisMonth.start, 2), userId: admin.id });
      }
      // Manual expense entries so the P&L tells a story.
      const exp = await tx.account.findMany({ where: { code: { in: ["6000", "6400", "6300"] } } });
      const byCode = Object.fromEntries(exp.map((a) => [a.code, a.id]));
      const { postJournal } = await import("../src/lib/accounting/posting");
      for (const period of [lastMonth, thisMonth]) {
        await postJournal(tx, {
          date: addDays(period.start, 0),
          memo: "Rent",
          source: "MANUAL",
          userId: admin.id,
          lines: [
            { accountId: byCode["6400"], debitCents: 280000 },
            { accountId: accounts.OPERATING_BANK, creditCents: 280000 },
          ],
        });
        if (period === lastMonth) {
          await postJournal(tx, {
            date: addDays(period.start, 14),
            memo: "Payroll (summarized from payroll provider)",
            source: "MANUAL",
            userId: admin.id,
            lines: [
              { accountId: byCode["6000"], debitCents: 412000 },
              { accountId: accounts.OPERATING_BANK, creditCents: 412000 },
            ],
          });
          await postJournal(tx, {
            date: addDays(period.start, 10),
            memo: "Food & supplies – Costco",
            source: "MANUAL",
            userId: admin.id,
            lines: [
              { accountId: byCode["6300"], debitCents: 38450 },
              { accountId: accounts.OPERATING_BANK, creditCents: 38450 },
            ],
          });
        }
      }
      await postJournal(tx, {
        date: addDays(lastMonth.start, -30),
        memo: "Opening bank balance",
        source: "MANUAL",
        userId: admin.id,
        lines: [
          { accountId: accounts.OPERATING_BANK, debitCents: 1500000 },
          { accountId: accounts.OPENING_BALANCE, creditCents: 1500000 },
        ],
      });
    },
    { timeout: 60_000 },
  );

  // Leads pipeline.
  const leadData = [
    { parentName: "Jordan Lee", childName: "Harper Lee", stage: "INQUIRY", source: "Website", classroomId: rooms.toddlers.id },
    { parentName: "Sam Rivera", childName: "Eli Rivera", stage: "TOUR_SCHEDULED", source: "Google", classroomId: rooms.preschool.id, tourAt: new Date(addDays(now, 2).getTime() + 15 * 3_600_000) },
    { parentName: "Alex Kim", childName: "Noah Kim", stage: "TOURED", source: "Referral – Garcia", classroomId: rooms.infants.id },
    { parentName: "Taylor Brooks", childName: "Lily Brooks", stage: "APPLIED", source: "Facebook", classroomId: rooms.preschool.id },
    { parentName: "Morgan Shaw", childName: "Owen Shaw", stage: "WAITLIST", source: "Website", classroomId: rooms.infants.id },
    { parentName: "Casey Ford", childName: "Ruby Ford", stage: "LOST", source: "Google", lostReason: "Chose a center closer to work" },
  ] as const;
  for (const [i, l] of leadData.entries()) {
    const lead = await prisma.lead.create({
      data: {
        ...l,
        email: `${l.parentName.split(" ")[0].toLowerCase()}@example.com`,
        phone: `(217) 555-02${10 + i}`,
        desiredStart: addDays(now, 30 + i * 7),
        childDob: new Date("2024-03-01"),
      },
    });
    await prisma.leadActivity.create({
      data: { leadId: lead.id, userId: director.id, kind: "NOTE", body: `Inquiry received via ${l.source}.` },
    });
  }

  // Front-desk kiosk login and demo PINs (Maria 246810, Luis 135792).
  await user("Front Desk Kiosk", "kiosk@demo.com", "KIOSK");
  for (const [first, pin] of [["Maria", "246810"], ["Luis", "135792"]] as const) {
    await prisma.guardian.updateMany({ where: { firstName: first, lastName: "Garcia" }, data: { pinDigest: pinDigest(pin), pinSetAt: new Date() } });
  }

  // Areas: each classroom's home room plus shared spaces.
  for (const room of Object.values(rooms)) await homeArea(prisma, room.id);
  const area = {
    playground: await prisma.area.create({ data: { name: "Playground" } }),
    gym: await prisma.area.create({ data: { name: "Gym" } }),
    nap: await prisma.area.create({ data: { name: "Nap Room" } }),
    art: await prisma.area.create({ data: { name: "Art Studio" } }),
  };

  // Staff on the floor.
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const omar = await prisma.user.findUniqueOrThrow({ where: { email: "omar@demo.com" } });
  const ines = await user("Ines Infant", "ines@demo.com", "TEACHER", { classroomId: rooms.infants.id });
  for (const [u, room] of [[teacher, rooms.toddlers], [omar, rooms.preschool], [ines, rooms.infants]] as const) {
    await prisma.staffShift.create({ data: { userId: u.id, classroomId: room.id, clockInAt: ago(300) } });
  }

  const kid = (firstName: string) => prisma.child.findFirstOrThrow({ where: { firstName } });
  const [sofia, mateo, leo, mia, nora, emma] = await Promise.all(["Sofia", "Mateo", "Leo", "Mia", "Nora", "Emma"].map(kid));

  // Yesterday: a full day with moves and pickups, for the daily log.
  const y = (h: number, m = 0) => {
    const d = addDays(new Date(), -1);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const yesterday: [typeof sofia, string, string, Date, Date][] = [
    [sofia, "Maria Garcia", "Luis Garcia", y(7, 40), y(17, 5)],
    [mateo, "Maria Garcia", "Luis Garcia", y(7, 41), y(17, 5)],
    [leo, "Daniel Park", "Wei Chen", y(8, 10), y(16, 20)],
    [mia, "Keisha Johnson", "Keisha Johnson", y(7, 55), y(17, 30)],
    [nora, "Sean O'Brien", "Sean O'Brien", y(8, 30), y(15, 45)],
    [emma, "Thanh Nguyen", "Thanh Nguyen", y(9, 0), y(16, 0)],
  ];
  for (const [child, dropper, , inAt] of yesterday) {
    await checkInChild(prisma, { childId: child.id, droppedOffBy: dropper, recordedBy: "Front desk", at: inAt });
  }
  await moveChildren(prisma, { childIds: [sofia.id, leo.id, nora.id], areaId: area.playground.id, recordedBy: omar.name, at: y(10) });
  await moveChildren(prisma, { childIds: [sofia.id, leo.id, nora.id], areaId: area.art.id, recordedBy: omar.name, at: y(11) });
  await moveChildren(prisma, { childIds: [mia.id, emma.id], areaId: area.nap.id, recordedBy: ines.name, at: y(12, 30) });
  await moveChildren(prisma, { childIds: [sofia.id, leo.id, nora.id], areaId: (await homeArea(prisma, rooms.preschool.id)).id, recordedBy: omar.name, at: y(12) });
  for (const [child, , picker, , outAt] of yesterday) {
    await checkOutChild(prisma, { childId: child.id, pickedUpBy: picker, recordedBy: "Front desk", at: outAt });
  }

  // Today: most children in; the preschool group is outside with Omar.
  await checkInChild(prisma, { childId: sofia.id, droppedOffBy: "Maria Garcia", recordedBy: "Front desk", at: ago(170) });
  await checkInChild(prisma, { childId: mateo.id, droppedOffBy: "Luis Garcia", recordedBy: "Front desk", at: ago(165) });
  await checkInChild(prisma, { childId: leo.id, droppedOffBy: "Daniel Park", recordedBy: "Front desk", at: ago(140) });
  await checkInChild(prisma, { childId: mia.id, droppedOffBy: "Keisha Johnson", recordedBy: "Front desk", at: ago(150) });
  await checkInChild(prisma, { childId: nora.id, droppedOffBy: "Sean O'Brien", recordedBy: "Front desk", at: ago(120) });
  await moveChildren(prisma, { childIds: [sofia.id, leo.id, nora.id], areaId: area.playground.id, recordedBy: omar.name, at: ago(45) });
  await moveChildren(prisma, { childIds: [mia.id], areaId: area.nap.id, recordedBy: ines.name, at: ago(30) });

  await prisma.message.create({
    data: { familyId: garcia.fam.id, authorId: teacher.id, body: "Mateo had a great day — painted with watercolors and napped 1.5 hrs!" },
  });

  console.log("Seeded Little Acorns Early Learning. Log in with director@demo.com / password123.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
