const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const restaurant = await prisma.restaurant.findUnique({ where: { slug: "grand-hotel" } });
  const category = await prisma.category.findFirst({
    where: { restaurantId: restaurant.id, name: "Drinks" },
  });
  const existing = await prisma.menuItem.findFirst({
    where: { categoryId: category.id, name: "Test Item" },
  });
  if (existing) {
    console.log("Test item already exists.");
    return;
  }
  await prisma.menuItem.create({
    data: { name: "Test Item", description: "For payment testing only", price: 1, categoryId: category.id },
  });
  console.log("Test item added (KES 1).");
}
main().finally(() => prisma.$disconnect());