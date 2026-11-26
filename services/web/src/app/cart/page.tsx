import Link from 'next/link';
import type { Metadata } from 'next';
import { CartView } from '@/components/Cart';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your cart — PayOps' };
export default function CartPage() {
  return <div className="payops-store"><div className="po-page"><div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> Your cart</div><CartView/></div></div>;
}
