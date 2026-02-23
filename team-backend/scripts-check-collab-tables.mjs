import "dotenv/config";
import { prisma } from "./src/db.ts";

const tables = await prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%collab%' ORDER BY table_name");
console.log('tables', tables);
for (const t of tables) {
  const name = t.table_name;
  const cols = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${name}' ORDER BY ordinal_position`);
  console.log(name, cols.map((c) => c.column_name));
}
await prisma.$disconnect();
