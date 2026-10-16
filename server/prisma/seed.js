const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const restaurant = await prisma.restaurant.upsert({
    where: { slug: "grand-hotel" },
    update: {},
    create: { name: "Grand Hotel", slug: "grand-hotel" },
  });
  for (let n = 1; n <= 10; n++) {
    await prisma.table.upsert({
      where: { restaurantId_number: { restaurantId: restaurant.id, number: n } },
      update: {},
      create: { number: n, restaurantId: restaurant.id },
    });
  }
  const count = await prisma.category.count({ where: { restaurantId: restaurant.id } });
  if (count === 0) {
    await prisma.category.create({
      data: {
        name: "Mains", sortOrder: 1, restaurantId: restaurant.id,
        items: { create: [
          { name: "Nyama Choma", description: "Grilled goat with kachumbari", price: 800 },
          { name: "Pilau", description: "Spiced rice with beef", price: 450 },
        ] },
      },
    });
    await prisma.category.create({
      data: {
        name: "Drinks", sortOrder: 2, restaurantId: restaurant.id,
        items: { create: [
          { name: "Fresh Passion Juice", price: 200 },
          { name: "Soda 300ml", price: 100 },
        ] },
      },
    });
  }
  console.log("Seeded.");
}
main().finally(() => prisma.$disconnect());