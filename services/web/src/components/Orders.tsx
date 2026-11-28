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
  const statusStyle =
    o.status === 'AUTHORIZED'
      ? { background: '#e3f1fb', color: '#0c5a8a' }
      : o.status === 'PENDING'
        ? { background: '#fff0dc', color: '#b35200' }
        : undefined;
  return <header>
    <div>
      <strong>Order {o.id}</strong>
      <small>{new Date(o.createdAt).toLocaleString('en-GB')}</small>
      {(o.routedConnector || o.routingSummary) && (
        <small style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
          {o.routedConnector && <span style={{ background: '#f1f1f2', padding: '2px 7px', borderRadius: '3px', color: '#303034' }}>Routed via: {o.routedConnector}</span>}
          {o.routingSummary && /failover/i.test(o.routingSummary) && <span style={{ background: '#fff0dc', padding: '2px 7px', borderRadius: '3px', color: '#b35200', fontWeight: 700 }}>Failover Recovered</span>}
        </small>
      )}
    </div>
    <b style={statusStyle}>{o.status.replaceAll('_', ' ')}</b>
  </header>;
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

  async function handleOrderAction(orderId: string, action: 'capture' | 'sync') {
    setBusyId(orderId);
    setActionMsg('');
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}/${action}`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || `Failed to ${action} order`);
      setActionMsg(action === 'capture' ? `Order ${orderId} captured and marked PAID.` : `Order ${orderId} synced (${d.order?.status || 'updated'}).`);
      await reload();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return <div className="payops-store po-account-wrap"><div className="po-page">
    <div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> <Link href="/account">Account</Link> <span>/</span> Your orders</div>
    {actionMsg && <p className="po-form-message" role="status" style={{ marginBottom: '14px' }}>{actionMsg}</p>}
    {orders === null && !error ? <p>Loading your orders…</p> : !customer ? <SignInPrompt what="Your order history"/> :
      <section className="po-orders"><div className="po-section-bar"><h2><Icon name="box"/>Your orders</h2><button onClick={reload}>Refresh ↻</button></div>
        {!orders!.length ? <div className="po-empty"><h3>Your story starts here.</h3><p>You haven't placed an account order yet.</p><Link className="po-orange-button" href="/products">Explore the collection</Link></div> :
          orders!.map(o => <article key={o.id} className="po-order"><OrderHeader o={o}/><OrderItems o={o}/>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
              <Link href={`/track?order=${o.id}`}>Track delivery →</Link>
              {o.status === 'AUTHORIZED' && (
                <button type="button" className="po-orange-button" disabled={busyId === o.id} onClick={() => handleOrderAction(o.id, 'capture')} style={{ minHeight: '34px', padding: '7px 14px', fontSize: '12px' }}>
                  {busyId === o.id ? 'Capturing…' : 'Confirm Shipment & Capture'}
                </button>
              )}
              {o.status === 'PENDING' && (
                <button type="button" disabled={busyId === o.id} onClick={() => handleOrderAction(o.id, 'sync')} style={{ border: '1px solid #ed8a2b', color: '#b85e09', borderRadius: '3px', padding: '7px 14px', fontSize: '12px', background: '#fff' }}>
                  {busyId === o.id ? 'Syncing…' : 'Sync Payment Status'}
                </button>
              )}
            </div>
          </article>)}
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
