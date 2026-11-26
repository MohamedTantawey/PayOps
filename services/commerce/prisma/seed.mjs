// Seed script: node prisma/seed.mjs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const products = [
  { name: "Aurora Hoodie", slug: "aurora-hoodie", description: "Heavyweight 450gsm hoodie with a gradient puff print.", priceCents: 145000, stock: 40, emoji: "🧥", gradient: "from-violet-600 to-fuchsia-500" },
  { name: "Nebula Sneakers", slug: "nebula-sneakers", description: "Chunky retro runner, glow-in-the-dark sole.", priceCents: 320000, stock: 25, emoji: "👟", gradient: "from-cyan-500 to-blue-600" },
  { name: "Orbit Cap", slug: "orbit-cap", description: "6-panel cap with embroidered orbit logo.", priceCents: 45000, stock: 100, emoji: "🧢", gradient: "from-amber-400 to-orange-600" },
  { name: "Pulse Tee", slug: "pulse-tee", description: "Oversized boxy tee, 240gsm combed cotton.", priceCents: 65000, stock: 80, emoji: "👕", gradient: "from-emerald-500 to-teal-600" },
  { name: "Echo Backpack", slug: "echo-backpack", description: "Water-resistant 20L daypack with laptop sleeve.", priceCents: 189000, stock: 30, emoji: "🎒", gradient: "from-rose-500 to-red-600" },
  { name: "Drift Jacket", slug: "drift-jacket", description: "Lightweight windbreaker with hidden pockets.", priceCents: 210000, stock: 15, emoji: "🌬️", gradient: "from-indigo-500 to-purple-600" },
];

for (const p of products) {
  await db.product.upsert({ where: { slug: p.slug }, update: {}, create: p });
}

console.log(`Seeded ${products.length} products.`);
await db.$disconnect();
