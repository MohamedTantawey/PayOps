import { commerce } from './backend';
import { DEMO_PRODUCTS, type StoreProduct } from '@/lib/demo';

// Shared server-side catalog reads. Falls back to the demo catalog so the
// storefront renders even before the database is migrated/seeded.
export async function getStoreProducts(): Promise<StoreProduct[]> {
  try {
    const p = await commerce('/api/catalog');
    if (p.length) return p;
  } catch {}
  return DEMO_PRODUCTS;
}

export async function getStoreProduct(slug: string): Promise<StoreProduct | null> {
  try {
    const p = await commerce('/api/catalog?slug='+encodeURIComponent(slug));
    if (p && p.active) return p;
  } catch {}
  return DEMO_PRODUCTS.find(d => d.slug === slug) || null;
}
