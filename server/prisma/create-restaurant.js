const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const [slug, name, count] = process.argv.slice(2);
  const tables = Number(count);
  if (!slug || !name || !Number.isInteger(tables) || tables < 1 || tables > 200) {
    throw new Error('Usage: node prisma/create-restaurant.js <slug> "<Name>" <tableCount>');
  }
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    throw new Error("Slug must be 3-40 characters: lowercase letters, numbers, hyphens");
  }
  const r = await prisma.restaurant.create({
    data: { slug, name, tables: { create: Array.from({ length: tables }, (_, i) => ({ number: i + 1 })) } },
  });
  console.log("Created " + r.name + " (" + r.slug + ") with " + tables + " tables");
}
main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());