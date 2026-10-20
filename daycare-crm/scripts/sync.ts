// CLI alternative to the cron endpoint: `npm run sync`.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncAll } from "../src/lib/integrations/sync";

syncAll()
  .then((results) => console.log(JSON.stringify(results, null, 2)))
  .finally(() => prisma.$disconnect());
