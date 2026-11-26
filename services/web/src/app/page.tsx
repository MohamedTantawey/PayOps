import { getStoreProducts } from '@/lib/catalog';
import { Home } from '@/components/Home';
export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const products = await getStoreProducts();
  return <Home products={products}/>;
}
