import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TrackPage } from '@/components/Orders';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Track your order — PayOps' };
export default function Page() {
  return <Suspense fallback={<div className="payops-store po-account-wrap"><div className="po-page"><p>Loading…</p></div></div>}><TrackPage/></Suspense>;
}
