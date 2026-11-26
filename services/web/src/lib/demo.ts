// Fallback catalog so the storefront renders even before the database
// is migrated/seeded. Matches the Prisma Product shape used by the UI.
export type StoreProduct = {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  currency: string;
  emoji: string;
  gradient: string;
  stock: number;
};

export const DEMO_PRODUCTS: StoreProduct[] = [
  { id: "demo-aurora-hoodie", name: "Aurora Hoodie", slug: "aurora-hoodie", description: "Heavyweight 450gsm hoodie with a gradient puff print.", priceCents: 145000, currency: "egp", emoji: "🧥", gradient: "from-violet-600 to-fuchsia-500", stock: 40 },
  { id: "demo-nebula-sneakers", name: "Nebula Sneakers", slug: "nebula-sneakers", description: "Chunky retro runner, glow-in-the-dark sole.", priceCents: 320000, currency: "egp", emoji: "👟", gradient: "from-cyan-500 to-blue-600", stock: 25 },
  { id: "demo-orbit-cap", name: "Orbit Cap", slug: "orbit-cap", description: "6-panel cap with embroidered orbit logo.", priceCents: 45000, currency: "egp", emoji: "🧢", gradient: "from-amber-400 to-orange-600", stock: 100 },
  { id: "demo-pulse-tee", name: "Pulse Tee", slug: "pulse-tee", description: "Oversized boxy tee, 240gsm combed cotton.", priceCents: 65000, currency: "egp", emoji: "👕", gradient: "from-emerald-500 to-teal-600", stock: 80 },
  { id: "demo-echo-backpack", name: "Echo Backpack", slug: "echo-backpack", description: "Water-resistant 20L daypack with laptop sleeve.", priceCents: 189000, currency: "egp", emoji: "🎒", gradient: "from-rose-500 to-red-600", stock: 30 },
  { id: "demo-drift-jacket", name: "Drift Jacket", slug: "drift-jacket", description: "Lightweight windbreaker with hidden pockets.", priceCents: 210000, currency: "egp", emoji: "🌬️", gradient: "from-indigo-500 to-purple-600", stock: 15 },
];

export function productCategory(slug: string): string {
  return /sneaker/.test(slug) ? 'Footwear' : /cap|backpack/.test(slug) ? 'Accessories' : 'Clothing';
}
