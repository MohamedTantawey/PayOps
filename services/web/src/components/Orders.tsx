"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import { Icon } from './Icon';

function useCustomerOrders() {
  const [customer, setCustomer] = useState<any>(null), [orders, setOrders] = useState<any[] | null>(null), [error, setError] = useState('');
  async function load() {
    try {
      const r = await fetch('/api/customer/auth'); const d = await r.json();
      if (!r.ok) throw Error('Account service unavailable. Check database setup.');
      setCustomer(d.customer);
      if (d.customer) { const o = await fetch('/api/customer/orders'); const data = await o.json(); if (!o.ok) throw Error(data.error); setOrders(data.orders); } else setOrders([]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load orders'); }
  }
  useEffect(() => { load(); }, []);
  return { customer, orders, error, reload: load };
}

function SignInPrompt({ what }: { what: string }) {
  return <div className="po-orders"><div className="po-empty"><h3>Sign in to continue.</h3><p>{what} lives in your PayOps account.</p><Link className="po-orange-button" href="/account">Sign in or create an account →</Link></div></div>;
}

function OrderHeader({ o }: { o: any }) {
  return <header><div><strong>Order {o.id}</strong><small>{new Date(o.createdAt).toLocaleString('en-GB')}</small></div><b>{o.status.replaceAll('_', ' ')}</b></header>;
}

function OrderItems({ o }: { o: any }) {
  return <>{o.demo && <p className="po-demo-label">DEMO ORDER • No money charged • No actual delivery</p>}<ul>{o.items.map((i: any, n: number) => <li key={n}><span>{i.name} × {i.quantity}</span><strong>{formatMoney(i.unitCents * i.quantity, o.currency)}</strong></li>)}</ul>{o.discountCents > 0 && <p>Coupon {o.couponCode}: −{formatMoney(o.discountCents, o.currency)}</p>}<div className="po-cart-total"><span>Total</span><strong>{formatMoney(o.totalCents, o.currency)}</strong></div></>;
}

function Tracking({ o }: { o: any }) {
  const steps = ['UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
  return <><h3>Delivery status</h3><ol className="po-tracking">{steps.map((s, i) => <li className={steps.indexOf(o.fulfillment) >= i ? 'is-complete' : ''} key={s}><i/>{s === 'UNFULFILLED' ? 'Order received' : s[0] + s.slice(1).toLowerCase()}</li>)}</ol>{o.fulfillmentNote && <p>{o.fulfillmentNote}</p>}{o.trackingNumber && <p>Tracking number: {o.trackingNumber}</p>}{o.trackingUrl && /^https:\/\//.test(o.trackingUrl) && <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer">Track with carrier ↗</a>}<small>Delivery status is updated by store staff. No live carrier integration is configured.</small></>;
}

export function OrdersPage() {
  const { customer, orders, error, reload } = useCustomerOrders();
  return <div className="payops-store po-account-wrap"><div className="po-page">
    <div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> <Link href="/account">Account</Link> <span>/</span> Your orders</div>
    {orders === null && !error ? <p>Loading your orders…</p> : !customer ? <SignInPrompt what="Your order history"/> :
      <section className="po-orders"><div className="po-section-bar"><h2><Icon name="box"/>Your orders</h2><button onClick={reload}>Refresh ↻</button></div>
        {!orders!.length ? <div className="po-empty"><h3>Your story starts here.</h3><p>You haven't placed an account order yet.</p><Link className="po-orange-button" href="/products">Explore the collection</Link></div> :
          orders!.map(o => <article key={o.id} className="po-order"><OrderHeader o={o}/><OrderItems o={o}/><p><Link href={`/track?order=${o.id}`}>Track delivery →</Link></p></article>)}
      </section>}
    {error && <p className="po-form-message" role="alert">{error}</p>}
  </div></div>;
}

export function TrackPage() {
  const { customer, orders, error, reload } = useCustomerOrders();
  const params = useSearchParams();
  const wanted = params.get('order');
  const order = wanted && orders ? orders.find(o => o.id === wanted) : null;
  return <div className="payops-store po-account-wrap"><div className="po-page">
    <div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> <Link href="/account">Account</Link> <span>/</span> Track your order{order && <> <span>/</span> {order.id}</>}</div>
    {orders === null && !error ? <p>Loading your orders…</p> : !customer ? <SignInPrompt what="Delivery tracking"/> :
      order ? <section className="po-orders"><div className="po-section-bar"><h2><Icon name="truck"/>Order tracking</h2><button onClick={reload}>Refresh ↻</button></div><article className="po-order"><OrderHeader o={order}/><OrderItems o={order}/><Tracking o={order}/></article></section> :
      <section className="po-orders"><div className="po-section-bar"><h2><Icon name="truck"/>Track your order</h2><button onClick={reload}>Refresh ↻</button></div>
        {wanted && !order && <div className="po-empty"><h3>Order not found.</h3><p>That order is not on your account. Pick one of your orders below.</p></div>}
        {!orders!.length ? <div className="po-empty"><h3>Nothing on the road yet.</h3><p>Once you place an order, follow it here from payment to delivery.</p><Link className="po-orange-button" href="/products">Explore the collection</Link></div> :
          orders!.map(o => <article key={o.id} className="po-order"><OrderHeader o={o}/><ol className="po-tracking">{['UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].map((s, i) => <li className={['UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].indexOf(o.fulfillment) >= i ? 'is-complete' : ''} key={s}><i/>{s === 'UNFULFILLED' ? 'Order received' : s[0] + s.slice(1).toLowerCase()}</li>)}</ol><p><Link href={`/track?order=${o.id}`}>Full tracking details →</Link></p></article>)}
      </section>}
    {error && <p className="po-form-message" role="alert">{error}</p>}
  </div></div>;
}
