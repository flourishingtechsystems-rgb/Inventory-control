import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

const DEMO_PASSWORD = "password123";

async function upsertUser(name: string, email: string, role: "REQUESTER" | "MANAGER" | "FINANCE" | "ADMIN") {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, passwordHash, role },
  });
}

const items: { name: string; unit: string; category: string }[] = [
  { name: "Toilet Paper", unit: "roll", category: "Restroom Supplies" },
  { name: "Paper Towels", unit: "package", category: "Restroom Supplies" },
  { name: "Hand Soap", unit: "bottle", category: "Restroom Supplies" },
  { name: "Trash Bags", unit: "box", category: "Cleaning Supplies" },
  { name: "All-Purpose Cleaner", unit: "bottle", category: "Cleaning Supplies" },
  { name: "Coffee", unit: "bag", category: "Break Room" },
  { name: "Creamer", unit: "bottle", category: "Break Room" },
  { name: "Printer Paper", unit: "ream", category: "Office Supplies" },
  { name: "Pens", unit: "box", category: "Office Supplies" },
  { name: "Sticky Notes", unit: "pack", category: "Office Supplies" },
];

async function main() {
  const requester = await upsertUser("Rita Requester", "requester@demo.com", "REQUESTER");
  const manager = await upsertUser("Mark Manager", "manager@demo.com", "MANAGER");
  const finance = await upsertUser("Fiona Finance", "finance@demo.com", "FINANCE");
  await upsertUser("Adam Admin", "admin@demo.com", "ADMIN");

  for (const item of items) {
    await prisma.inventoryItem.upsert({
      where: { name_unit: { name: item.name, unit: item.unit } },
      update: {},
      create: item,
    });
  }

  const existingRequests = await prisma.orderRequest.count();
  if (existingRequests === 0) {
    const toiletPaper = await prisma.inventoryItem.findFirstOrThrow({ where: { name: "Toilet Paper" } });
    const paperTowels = await prisma.inventoryItem.findFirstOrThrow({ where: { name: "Paper Towels" } });
    const coffee = await prisma.inventoryItem.findFirstOrThrow({ where: { name: "Coffee" } });

    const sampleRequest = await prisma.orderRequest.create({
      data: {
        requesterId: requester.id,
        notes: "Running low in the main restroom.",
        items: {
          create: [
            { inventoryItemId: toiletPaper.id, quantity: 2 },
            { inventoryItemId: paperTowels.id, quantity: 3 },
          ],
        },
      },
    });

    await prisma.notification.create({
      data: {
        userId: manager.id,
        message: `${requester.name} submitted a new order request.`,
        link: `/approvals`,
      },
    });

    const approvedRequest = await prisma.orderRequest.create({
      data: {
        requesterId: requester.id,
        status: "APPROVED",
        decidedAt: new Date(),
        decidedById: manager.id,
        items: {
          create: [{ inventoryItemId: coffee.id, quantity: 4 }],
        },
      },
    });

    await prisma.notification.create({
      data: {
        userId: finance.id,
        message: `Order request from ${requester.name} was approved by ${manager.name}.`,
        link: `/finance`,
      },
    });

    console.log(`Seeded sample requests ${sampleRequest.id} and ${approvedRequest.id}`);
  }

  console.log("Seed complete. Demo accounts (password: %s):", DEMO_PASSWORD);
  console.log("  requester@demo.com / manager@demo.com / finance@demo.com / admin@demo.com");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
