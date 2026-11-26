import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoreProduct, getStoreProducts } from '@/lib/catalog';
import { productCategory } from '@/lib/demo';
import { ProductDetail } from '@/components/ProductDetail';
export const dynamic = 'force-dynamic';
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getStoreProduct(slug);
  if (!product) notFound();
  const all = await getStoreProducts();
  const related = all.filter(p => p.slug !== slug && productCategory(p.slug) === productCategory(slug));
  return <div className="payops-store"><div className="po-page"><div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> <Link href="/products">PayOps collection</Link> <span>/</span> {product.name}</div><ProductDetail product={product} related={related}/></div></div>;
}
