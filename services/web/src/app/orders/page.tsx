import type { Metadata } from 'next';
import { OrdersPage } from '@/components/Orders';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your orders — PayOps' };
export default function Page() {
  return <OrdersPage/>;
}
