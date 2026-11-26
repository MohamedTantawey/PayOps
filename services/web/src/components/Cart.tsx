"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { StoreProduct } from '@/lib/demo';
import { formatMoney } from '@/lib/money';
import { ProductArt } from './ProductArt';

type Line = { product: StoreProduct; quantity: number };
type Address = { name: string; phone: string; street: string; city: string; country: string };
type CartState = {
  add: (p: StoreProduct) => void;
  open: () => void;
  count: number;
  ready: boolean;
  lines: Line[];
  setQuantity: (id: string, q: number) => void;
  removeLine: (id: string) => void;
  logged: boolean;
  busy: boolean;
  uncertain: boolean;
  message: string;
  coupon: string;
  setCoupon: (c: string) => void;
  applyCoupon: () => void;
  discount: number;
  applied: string;
  subtotal: number;
  address: Address;
  setAddress: (a: Address) => void;
  checkout: () => void;
};
const CartContext = createContext<CartState>({ add: () => {}, open: () => {}, count: 0, ready: false, lines: [], setQuantity: () => {}, removeLine: () => {}, logged: false, busy: false, uncertain: false, message: '', coupon: '', setCoupon: () => {}, applyCoupon: () => {}, discount: 0, applied: '', subtotal: 0, address: { name: '', phone: '', street: '', city: '', country: 'Egypt' }, setAddress: () => {}, checkout: () => {} });
export const useCart = () => useContext(CartContext);

export function CartProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]), [ready, setReady] = useState(false), [logged, setLogged] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [coupon, setCoupon] = useState(''), [discount, setDiscount] = useState(0), [applied, setApplied] = useState(''); const [address, setAddress] = useState<Address>({ name: '', phone: '', street: '', city: '', country: 'Egypt' });
  const attempt = useRef<{ key: string; body: string }>();

  useEffect(() => { (async () => {
    let local: Line[] = [];
    try { const saved = JSON.parse(localStorage.getItem('payops-cart-v2') || '[]'); if (Array.isArray(saved)) local = saved.filter((x: any) => x?.product?.id && typeof x.product.priceCents === 'number' && Number.isInteger(x.quantity) && x.quantity > 0).map((x: Line) => ({ ...x, quantity: Math.min(10, x.quantity) })); } catch {}
    try {
      const r = await fetch('/api/customer/auth'); const data = await r.json();
      if (data.customer) {
        setLogged(true); setAddress(a => ({ ...a, name: data.customer.name }));
        const remote = await fetch('/api/customer/cart'); const cart = await remote.json();
        if (remote.ok) {
          const owner = localStorage.getItem('payops-cart-owner');
          if (cart.lines.length || owner === data.customer.id) local = cart.lines;
          else if (local.length) { const merge = await fetch('/api/customer/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: local.map(l => ({ productId: l.product.id, quantity: l.quantity })) }) }); if (!merge.ok) setMessage('Some saved items could not sync. Review stock before checkout.'); }
          localStorage.setItem('payops-cart-owner', data.customer.id);
        }
      }
    } catch {}
    try { const pending = JSON.parse(sessionStorage.getItem('payops-checkout-items') || 'null'); if (pending) { const r = await fetch('/api/customer/orders'); if (r.ok) { const { orders } = await r.json(); const order = orders.find((o: any) => o.id === pending.orderId); if (order && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status)) { sessionStorage.removeItem('payops-checkout-items'); sessionStorage.removeItem('payops-checkout-attempt'); } } } } catch {}
    try { const savedAttempt = JSON.parse(sessionStorage.getItem('payops-checkout-attempt') || 'null'); if (savedAttempt?.key && savedAttempt?.body) { attempt.current = savedAttempt; const prior = JSON.parse(savedAttempt.body); setAddress(prior.address); setApplied(prior.coupon || ''); setCoupon(prior.coupon || ''); setUncertain(true); setMessage('A previous checkout needs a retry. Go to your cart and retry without changing the order.'); } } catch {}
    setLines(local); setReady(true);
  })(); }, []);

  useEffect(() => { const reload = () => { try { setLines(JSON.parse(localStorage.getItem('payops-cart-v2') || '[]')); } catch {} }; window.addEventListener('payops-cart-cleanup', reload); return () => window.removeEventListener('payops-cart-cleanup', reload); }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem('payops-cart-v2', JSON.stringify(lines));
    if (!attempt.current) { setDiscount(0); setApplied(''); }
    if (logged) {
      if (busy) return;
      const timer = setTimeout(() => { fetch('/api/customer/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: lines.map(x => ({ productId: x.product.id, quantity: x.quantity })) }) }).then(async r => { if (!r.ok) setMessage((await r.json()).error || 'Cart could not sync'); }).catch(() => setMessage('Cart saved on this device. Server sync failed.')); }, 400);
      return () => clearTimeout(timer);
    }
  }, [lines, ready, logged, busy]);

  function add(p: StoreProduct) {
    if (uncertain) { router.push('/cart'); return; }
    setLines(ls => { const found = ls.find(x => x.product.id === p.id); return found ? ls.map(x => x.product.id === p.id ? { product: p, quantity: Math.min(x.quantity + 1, 10, p.stock) } : x) : [...ls, { product: p, quantity: 1 }]; });
    setMessage('');
    router.push('/cart');
  }
  function open() { router.push('/cart'); }
  function setQuantity(id: string, q: number) { setLines(ls => ls.map(x => x.product.id === id ? { ...x, quantity: Math.max(1, Math.min(10, x.product.stock, q || 1)) } : x)); }
  function removeLine(id: string) { setLines(ls => ls.filter(x => x.product.id !== id)); }

  const items = lines.map(l => ({ productId: l.product.id, quantity: l.quantity }));
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.product.priceCents, 0);

  async function applyCoupon() {
    setBusy(true); setMessage('');
    try { const r = await fetch('/api/marketplace/coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, code: coupon }) }); const d = await r.json(); if (!r.ok) throw Error(d.error); setDiscount(d.discountCents); setApplied(d.code || ''); setMessage(d.code ? 'Coupon applied. Final total is verified at checkout.' : 'Coupon removed.'); } catch (e) { setDiscount(0); setApplied(''); setMessage(e instanceof Error ? e.message : 'Coupon failed'); } finally { setBusy(false); }
  }

  async function checkout() {
    setBusy(true); setMessage('');
    const body = uncertain && attempt.current ? attempt.current.body : JSON.stringify({ items, coupon: applied, address });
    if (!attempt.current || attempt.current.body !== body) attempt.current = { key: crypto.randomUUID(), body };
    sessionStorage.setItem('payops-checkout-attempt', JSON.stringify(attempt.current));
    try {
      if (!uncertain) { const sync = await fetch('/api/customer/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); if (!sync.ok) throw Error('Input: ' + (await sync.json()).error); }
      const r = await fetch('/api/marketplace/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key }, body }); const d = await r.json();
      if (!r.ok) { if (r.status >= 500 || r.status === 409) setUncertain(true); throw Error((r.status < 500 && r.status !== 409 ? 'Input: ' : '') + d.error); }
      sessionStorage.removeItem('payops-checkout-attempt');
      sessionStorage.setItem('payops-checkout-items', JSON.stringify({ items, orderId: d.orderId }));
      window.location.href = d.url;
    } catch (e) {
      if (!(e instanceof Error && e.message.startsWith('Input: '))) setUncertain(true); else { sessionStorage.removeItem('payops-checkout-attempt'); attempt.current = undefined; }
      setMessage((e instanceof Error ? e.message.replace(/^Input: /, '') : 'Checkout failed') + ' Your checkout may already exist. Retry the same request below. Do not start another checkout.');
      setBusy(false);
    }
  }

  const value: CartState = { add, open, count: lines.reduce((s, x) => s + x.quantity, 0), ready, lines, setQuantity, removeLine, logged, busy, uncertain, message, coupon, setCoupon, applyCoupon, discount, applied, subtotal, address, setAddress, checkout };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function CartView() {
  const c = useCart();
  return <section className="po-cart po-cart-page" aria-label="Shopping cart">
    <div className="po-cart-heading"><h1>Your cart <span>({c.count})</span></h1><Link className="po-continue" href="/products">Continue shopping →</Link></div>
    <p className="po-cart-note">{c.logged ? 'Synced with your PayOps account.' : 'Saved on this device. Sign in to sync and check out.'} Stock and prices are checked again by the server.</p>
    {!c.lines.length ? <div className="po-cart-empty"><h3>Your next favourite is waiting.</h3><p>Explore the collection and add something you love.</p><Link className="po-orange-button" href="/products">Explore the collection</Link></div> : <>
      <div className="po-cart-lines">{c.lines.map(({ product: p, quantity }) => <article key={p.id}><Link className="po-cart-art" href={`/products/${p.slug}`} aria-label={`View ${p.name}`}><ProductArt slug={p.slug} name={p.name}/></Link><div><h3><Link href={`/products/${p.slug}`}>{p.name}</Link></h3><strong>{formatMoney(p.priceCents, p.currency)}</strong><label>Quantity <input disabled={c.busy || c.uncertain} aria-label={`Quantity for ${p.name}`} type="number" min="1" max={Math.min(10, p.stock)} value={quantity} onChange={e => c.setQuantity(p.id, Number(e.target.value))}/></label><button disabled={c.busy || c.uncertain} className="po-remove" onClick={() => c.removeLine(p.id)}>Remove</button></div></article>)}</div>
      <div className="po-coupon"><label htmlFor="coupon">Have a coupon?</label><div><input id="coupon" value={c.coupon} maxLength={40} disabled={c.busy || c.uncertain} onChange={e => c.setCoupon(e.target.value)} placeholder="Enter code"/><button disabled={c.busy || c.uncertain} onClick={c.applyCoupon}>Apply</button></div></div>
      <div className="po-cart-total"><span>Subtotal</span><strong>{formatMoney(c.subtotal, 'egp')}</strong></div>
      {c.discount > 0 && <div className="po-cart-total"><span>Coupon {c.applied}</span><strong>−{formatMoney(c.discount, 'egp')}</strong></div>}
      <div className="po-cart-total po-grand-total"><span>Total</span><strong>{formatMoney(c.subtotal - c.discount, 'egp')}</strong></div>
      <p className="po-cart-note">No shipping or tax charges are added by this starter. Configure actual store policies before launch.</p>
      {c.logged ? <form className="po-address" onSubmit={e => { e.preventDefault(); c.checkout(); }}><h3>Delivery details</h3>{(['name', 'phone', 'street', 'city', 'country'] as const).map(field => <label key={field}>{field === 'name' ? 'Full name' : field === 'street' ? 'Street address' : field[0].toUpperCase() + field.slice(1)}<input disabled={c.busy || c.uncertain} required minLength={2} maxLength={200} type={field === 'phone' ? 'tel' : 'text'} autoComplete={field === 'name' ? 'name' : field === 'phone' ? 'tel' : field === 'street' ? 'street-address' : field === 'city' ? 'address-level2' : 'country-name'} value={c.address[field]} onChange={e => c.setAddress({ ...c.address, [field]: e.target.value })}/></label>)}<button className="po-orange-button" disabled={c.busy}>{c.busy ? 'Opening checkout…' : 'Proceed to checkout'}</button></form> : <Link className="po-orange-button" href="/account">Sign in to checkout →</Link>}
    </>}
    {c.message && <p className="po-form-message" role="status">{c.message}</p>}
  </section>;
}
