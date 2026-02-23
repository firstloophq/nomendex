import "dotenv/config";
import { prisma } from "./src/db.ts";

const cols = await prisma.$queryRawUnsafe("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CollabDoc' ORDER BY ordinal_position");
console.log('CollabDoc columns:', cols);

const migrations = await prisma.$queryRawUnsafe("SELECT migration_name, finished_at, rolled_back_at FROM \"_prisma_migrations\" ORDER BY started_at DESC LIMIT 10");
console.log('Migrations:', migrations);

await prisma.$disconnect();
