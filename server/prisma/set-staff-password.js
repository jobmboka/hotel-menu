const { PrismaClient } = require("@prisma/client");
const { randomBytes, scryptSync } = require("crypto");
const prisma = new PrismaClient();
async function main() {
  const slug = process.argv[2];
  const password = process.env.NEW_STAFF_PASSWORD;
  if (!slug || !password) {
    throw new Error("Usage: set NEW_STAFF_PASSWORD, then run: node prisma/set-staff-password.js <slug>");
  }
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  await prisma.restaurant.update({
    where: { slug },
    data: { staffPasswordHash: salt.toString("hex") + ":" + hash.toString("hex") },
  });
  console.log("Staff password set for " + slug);
}
main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());