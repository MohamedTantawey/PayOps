import Link from 'next/link';
import type { Metadata } from 'next';
import { getStoreProducts } from '@/lib/catalog';
import { Catalog } from '@/components/Catalog';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'The PayOps collection — all products' };
export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const [products, params] = await Promise.all([getStoreProducts(), searchParams]);
  const q = params.q || '';
  const cat = params.cat || 'All products';
  return <div className="payops-store"><div className="po-page"><div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> PayOps collection</div><Catalog key={cat + '|' + q} products={products} initialQuery={q} initialCategory={cat}/></div></div>;
}
