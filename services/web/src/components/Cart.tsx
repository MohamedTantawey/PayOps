"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import type { StoreProduct } from '@/lib/demo';
import { convertFromEgpCents, formatMoney } from '@/lib/money';
import { ProductArt } from './ProductArt';

type Line = { product: StoreProduct; quantity: number };
type Address = { name: string; phone: string; street: string; city: string; country: string };
type CurrencyCode = 'EGP' | 'USD';
type SavedMethod = { id: string; vaultToken: string; paymentMethod: string; label: string; last4: string | null; currency: string };
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
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  paymentMethod: string;
  setPaymentMethod: (m: string) => void;
  accountIdentifier: string;
  setAccountIdentifier: (v: string) => void;
  cardNumber: string;
  setCardNumber: (v: string) => void;
  saveToVault: boolean;
  setSaveToVault: (v: boolean) => void;
  savedMethods: SavedMethod[];
  selectedVaultToken: string;
  setSelectedVaultToken: (t: string) => void;
  simulateFailover: boolean;
  setSimulateFailover: (v: boolean) => void;
  manualCapture: boolean;
  setManualCapture: (v: boolean) => void;
  idemResult: string;
  runIdempotencyDemo: () => void;
  address: Address;
  setAddress: (a: Address) => void;
  checkout: () => void;
};
const CartContext = createContext<CartState>({ add: () => {}, open: () => {}, count: 0, ready: false, lines: [], setQuantity: () => {}, removeLine: () => {}, logged: false, busy: false, uncertain: false, message: '', coupon: '', setCoupon: () => {}, applyCoupon: () => {}, discount: 0, applied: '', subtotal: 0, currency: 'EGP', setCurrency: () => {}, paymentMethod: 'visa', setPaymentMethod: () => {}, accountIdentifier: '', setAccountIdentifier: () => {}, cardNumber: '4242424242424242', setCardNumber: () => {}, saveToVault: false, setSaveToVault: () => {}, savedMethods: [], selectedVaultToken: '', setSelectedVaultToken: () => {}, simulateFailover: false, setSimulateFailover: () => {}, manualCapture: false, setManualCapture: () => {}, idemResult: '', runIdempotencyDemo: () => {}, address: { name: '', phone: '', street: '', city: '', country: 'Egypt' }, setAddress: () => {}, checkout: () => {} });
export const useCart = () => useContext(CartContext);

export function CartProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [lines, setLines] = useState<Line[]>([]), [ready, setReady] = useState(false), [logged, setLogged] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [coupon, setCoupon] = useState(''), [discount, setDiscount] = useState(0), [applied, setApplied] = useState(''); const [address, setAddress] = useState<Address>({ name: '', phone: '', street: '', city: '', country: 'Egypt' });
  const [currency, setCurrencyState] = useState<CurrencyCode>('EGP');
  const [paymentMethod, setPaymentMethod] = useState<string>('visa');
  const [accountIdentifier, setAccountIdentifier] = useState<string>('');
  const [cardNumber, setCardNumber] = useState<string>('4242424242424242');
  const [saveToVault, setSaveToVault] = useState<boolean>(false);
  const [savedMethods, setSavedMethods] = useState<SavedMethod[]>([]);
  const [selectedVaultToken, setSelectedVaultToken] = useState<string>('');
  const [simulateFailover, setSimulateFailover] = useState<boolean>(false);
  const [manualCapture, setManualCapture] = useState<boolean>(false);
  const [idemResult, setIdemResult] = useState<string>('');
  const attempt = useRef<{ key: string; body: string }>();

  function setCurrency(next: CurrencyCode) {
    setCurrencyState(next);
    try { localStorage.setItem('payops-currency', next); } catch {}
    setPaymentMethod(next === 'USD' ? 'stripe_card' : 'visa');
    setSelectedVaultToken('');
  }

  useEffect(() => { (async () => {
    let local: Line[] = [];
    try { const saved = JSON.parse(localStorage.getItem('payops-cart-v2') || '[]'); if (Array.isArray(saved)) local = saved.filter((x: any) => x?.product?.id && typeof x.product.priceCents === 'number' && Number.isInteger(x.quantity) && x.quantity > 0).map((x: Line) => ({ ...x, quantity: Math.min(10, x.quantity) })); } catch {}
    try {
      const savedCurr = localStorage.getItem('payops-currency');
      if (savedCurr === 'USD' || savedCurr === 'EGP') {
        setCurrencyState(savedCurr);
        setPaymentMethod(savedCurr === 'USD' ? 'stripe_card' : 'visa');
      }
    } catch {}
    try {
      const r = await fetch('/api/customer/auth'); const data = await r.json();
      if (data.customer) {
        setLogged(true); setAddress(a => ({ ...a, name: data.customer.name }));
        fetch('/api/payment-methods').then(res => res.ok ? res.json() : null).then(pm => { if (pm?.methods) setSavedMethods(pm.methods); }).catch(() => {});
        const remote = await fetch('/api/customer/cart'); const cart = await remote.json();
        if (remote.ok) {
          const owner = localStorage.getItem('payops-cart-owner');
          if (cart.lines.length || owner === data.customer.id) local = cart.lines;
          else if (local.length) { const merge = await fetch('/api/customer/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: local.map(l => ({ productId: l.product.id, quantity: l.quantity })) }) }); if (!merge.ok) setMessage('Some saved items could not sync. Review stock before checkout.'); }
          localStorage.setItem('payops-cart-owner', data.customer.id);
        }
      }
    } catch {}
    try { const pending = JSON.parse(sessionStorage.getItem('payops-checkout-items') || 'null'); if (pending) { const r = await fetch('/api/customer/orders'); if (r.ok) { const { orders } = await r.json(); const order = orders.find((o: any) => o.id === pending.orderId); if (order && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status)) { const bought = new Map<string, number>((pending.items || []).map((i: any) => [i.productId, i.quantity] as [string, number])); local = local.map(l => ({ ...l, quantity: l.quantity - (bought.get(l.product.id) ?? 0) })).filter(l => l.quantity > 0); localStorage.setItem('payops-cart-v2', JSON.stringify(local)); sessionStorage.removeItem('payops-checkout-items'); sessionStorage.removeItem('payops-checkout-attempt'); } } } } catch {}
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

  // Poll for order payment on the success page, then remove purchased items from cart
  useEffect(() => {
    if (!pathname.startsWith('/checkout/success')) return;
    let cancelled = false;
    (async () => {
      try {
        const pending = JSON.parse(sessionStorage.getItem('payops-checkout-items') || 'null');
        if (!pending || !pending.orderId) return;
        for (let i = 0; i < 6 && !cancelled; i++) {
          const r = await fetch('/api/customer/orders', { cache: 'no-store' });
          if (r.ok) {
            const { orders } = await r.json();
            const order = orders.find((o: any) => o.id === pending.orderId);
            if (order && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status)) {
              const bought = new Map<string, number>((pending.items || []).map((i: any) => [i.productId, i.quantity] as [string, number]));
              setLines(ls => {
                const next = ls.map(l => ({ ...l, quantity: l.quantity - (bought.get(l.product.id) ?? 0) })).filter(l => l.quantity > 0);
                localStorage.setItem('payops-cart-v2', JSON.stringify(next));
                sessionStorage.removeItem('payops-checkout-items');
                sessionStorage.removeItem('payops-checkout-attempt');
                globalThis.dispatchEvent(new Event('payops-cart-cleanup'));
                return next;
              });
              return;
            }
          }
          await new Promise(res => setTimeout(res, 1000));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

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

  async function runIdempotencyDemo() {
    setBusy(true); setIdemResult('');
    try {
      const r = await fetch('/api/orders/idempotency-demo', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Demo failed');
      setIdemResult(`Key ${d.idempotencyKey}: Req1=${JSON.stringify(d.first)} | Req2=${JSON.stringify(d.second)} | Double-charge prevented: ${d.doubleChargePrevented}`);
    } catch (e) {
      setIdemResult(e instanceof Error ? e.message : 'Idempotency probe failed');
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    setBusy(true); setMessage('');
    let vaultTokenToUse = selectedVaultToken || undefined;
    if (!uncertain && saveToVault && !vaultTokenToUse) {
      try {
        const tokenBody = (paymentMethod === 'visa' || paymentMethod === 'stripe_card')
          ? { paymentMethod, currency, card: { number: cardNumber, exp_month: 12, exp_year: 2028, cvv: '123' } }
          : { paymentMethod, currency, accountIdentifier: accountIdentifier || (paymentMethod === 'instapay' ? 'buyer@instapay' : paymentMethod === 'vodafone_cash' ? '01012345678' : 'buyer@paypal.example') };
        const tr = await fetch('/api/payment-methods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tokenBody) });
        const td = await tr.json().catch(() => ({}));
        if (tr.ok && td.method?.vaultToken) {
          vaultTokenToUse = td.method.vaultToken;
          setSavedMethods(prev => [td.method, ...prev.filter(x => x.vaultToken !== td.method.vaultToken)]);
        }
      } catch {}
    }
    const body = uncertain && attempt.current ? attempt.current.body : JSON.stringify({ items, coupon: applied, address, currency, paymentMethod, captureMethod: manualCapture ? 'manual' : 'automatic', vaultToken: vaultTokenToUse, simulateFailover });
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

  const value: CartState = { add, open, count: lines.reduce((s, x) => s + x.quantity, 0), ready, lines, setQuantity, removeLine, logged, busy, uncertain, message, coupon, setCoupon, applyCoupon, discount, applied, subtotal, currency, setCurrency, paymentMethod, setPaymentMethod, accountIdentifier, setAccountIdentifier, cardNumber, setCardNumber, saveToVault, setSaveToVault, savedMethods, selectedVaultToken, setSelectedVaultToken, simulateFailover, setSimulateFailover, manualCapture, setManualCapture, idemResult, runIdempotencyDemo, address, setAddress, checkout };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function CartView() {
  const c = useCart();
  const displaySubtotal = convertFromEgpCents(c.subtotal, c.currency);
  const displayDiscount = c.discount > 0 ? convertFromEgpCents(c.discount, c.currency) : 0;
  const egpMethods = [
    { id: 'instapay', label: 'InstaPay', hint: 'buyer@instapay' },
    { id: 'vodafone_cash', label: 'Vodafone Cash', hint: '01012345678' },
    { id: 'visa', label: 'Visa / Local Card', hint: '4242424242424242' },
  ];
  const usdMethods = [
    { id: 'stripe_card', label: 'Stripe Credit Card', hint: '4242424242424242' },
    { id: 'paypal', label: 'PayPal', hint: 'buyer@paypal.example' },
  ];
  const methods = c.currency === 'USD' ? usdMethods : egpMethods;
  const isCardMethod = c.paymentMethod === 'visa' || c.paymentMethod === 'stripe_card';

  return <section className="po-cart po-cart-page" aria-label="Shopping cart">
    <div className="po-cart-heading"><h1>Your cart <span>({c.count})</span></h1><Link className="po-continue" href="/products">Continue shopping →</Link></div>
    <p className="po-cart-note">{c.logged ? 'Synced with your PayOps account.' : 'Saved on this device. Sign in to sync and check out.'} Stock and prices are checked again by the server.</p>
    {!c.lines.length ? <div className="po-cart-empty"><h3>Your next favourite is waiting.</h3><p>Explore the collection and add something you love.</p><Link className="po-orange-button" href="/products">Explore the collection</Link></div> : <>
      <div className="po-cart-lines">{c.lines.map(({ product: p, quantity }) => <article key={p.id}><Link className="po-cart-art" href={`/products/${p.slug}`} aria-label={`View ${p.name}`}><ProductArt slug={p.slug} name={p.name}/></Link><div><h3><Link href={`/products/${p.slug}`}>{p.name}</Link></h3><strong>{formatMoney(convertFromEgpCents(p.priceCents, c.currency), c.currency)}</strong><label>Quantity <input disabled={c.busy || c.uncertain} aria-label={`Quantity for ${p.name}`} type="number" min="1" max={Math.min(10, p.stock)} value={quantity} onChange={e => c.setQuantity(p.id, Number(e.target.value))}/></label><button disabled={c.busy || c.uncertain} className="po-remove" onClick={() => c.removeLine(p.id)}>Remove</button></div></article>)}</div>
      <div className="po-coupon"><label htmlFor="coupon">Have a coupon?</label><div><input id="coupon" value={c.coupon} maxLength={40} disabled={c.busy || c.uncertain} onChange={e => c.setCoupon(e.target.value)} placeholder="Enter code"/><button disabled={c.busy || c.uncertain} onClick={c.applyCoupon}>Apply</button></div></div>
      <div className="po-cart-total" style={{ alignItems: 'center' }}>
        <span>Checkout Currency (1 USD = 50 EGP)</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['EGP', 'USD'] as const).map(code => (
            <button key={code} type="button" disabled={c.busy || c.uncertain} onClick={() => c.setCurrency(code)} style={{ padding: '6px 12px', borderRadius: '3px', fontSize: '12px', fontWeight: 700, border: '1px solid #ed8a2b', background: c.currency === code ? '#ef861d' : '#fff', color: c.currency === code ? '#fff' : '#b85e09' }}>
              {code === 'USD' ? 'USD $' : 'EGP ج.م'}
            </button>
          ))}
        </div>
      </div>
      <div className="po-cart-total"><span>Subtotal</span><strong>{formatMoney(displaySubtotal, c.currency)}</strong></div>
      {displayDiscount > 0 && <div className="po-cart-total"><span>Coupon {c.applied}</span><strong>−{formatMoney(displayDiscount, c.currency)}</strong></div>}
      <div className="po-cart-total po-grand-total"><span>Total</span><strong>{formatMoney(displaySubtotal - displayDiscount, c.currency)}</strong></div>

      {c.logged && (
        <div style={{ paddingTop: '16px', borderBottom: '1px solid #eee', paddingBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <strong style={{ fontSize: '14px' }}>Payment Method ({c.currency})</strong>
            <span className="po-cart-count" style={{ padding: '3px 8px' }}>Test Mode</span>
          </div>
          {c.savedMethods.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px', color: '#555' }}>1-Click Saved Payment Method (PayOps Vault)</label>
              <select value={c.selectedVaultToken} disabled={c.busy || c.uncertain} onChange={e => c.setSelectedVaultToken(e.target.value)} style={{ width: '100%', border: '1px solid #ddd', borderRadius: '3px', padding: '8px', fontSize: '13px', background: '#fff' }}>
                <option value="">Use a new payment method below</option>
                {c.savedMethods.map(m => <option key={m.id} value={m.vaultToken}>{m.label} ({m.currency})</option>)}
              </select>
            </div>
          )}
          {!c.selectedVaultToken && (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {methods.map(m => (
                  <button key={m.id} type="button" disabled={c.busy || c.uncertain} onClick={() => { c.setPaymentMethod(m.id); if (m.id === 'instapay' || m.id === 'vodafone_cash' || m.id === 'paypal') c.setAccountIdentifier(m.hint); }} style={{ padding: '8px 12px', borderRadius: '3px', fontSize: '12px', border: c.paymentMethod === m.id ? '2px solid #ef861d' : '1px solid #ddd', background: c.paymentMethod === m.id ? '#fff0dc' : '#fff', color: '#303034', fontWeight: c.paymentMethod === m.id ? 700 : 400 }}>
                    {m.label}
                  </button>
                ))}
              </div>
              {isCardMethod ? (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <button type="button" onClick={() => c.setCardNumber('4242424242424242')} style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid #ddd', borderRadius: '3px', background: '#fafafa' }}>Success 4242...</button>
                    <button type="button" onClick={() => c.setCardNumber('4000000000000002')} style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid #ddd', borderRadius: '3px', background: '#fafafa' }}>Decline 4000...0002</button>
                  </div>
                  <input value={c.cardNumber} disabled={c.busy || c.uncertain} onChange={e => c.setCardNumber(e.target.value)} placeholder="Test card number" style={{ width: '100%', border: '1px solid #ddd', borderRadius: '3px', padding: '8px', fontSize: '13px' }} />
                </div>
              ) : (
                <input value={c.accountIdentifier} disabled={c.busy || c.uncertain} onChange={e => c.setAccountIdentifier(e.target.value)} placeholder={c.paymentMethod === 'instapay' ? 'IPA handle (e.g. buyer@instapay)' : c.paymentMethod === 'vodafone_cash' ? 'Wallet number (e.g. 01012345678)' : 'PayPal email'} style={{ width: '100%', border: '1px solid #ddd', borderRadius: '3px', padding: '8px', fontSize: '13px', marginBottom: '8px' }} />
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#555' }}>
                <input type="checkbox" checked={c.saveToVault} disabled={c.busy || c.uncertain} onChange={e => c.setSaveToVault(e.target.checked)} />
                Save payment method securely (PayOps Vault)
              </label>
            </>
          )}
          <details style={{ marginTop: '12px', background: '#fafafa', border: '1px solid #eee', borderRadius: '4px', padding: '10px 12px' }}>
            <summary style={{ fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', color: '#303034' }}>PayOps Sandbox Demo Controls</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', fontSize: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={c.simulateFailover} disabled={c.busy || c.uncertain} onChange={e => c.setSimulateFailover(e.target.checked)} />
                Smart Failover (simulate primary PSP outage → secondary)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={c.manualCapture} disabled={c.busy || c.uncertain} onChange={e => c.setManualCapture(e.target.checked)} />
                Manual Capture (authorize only, capture on shipment)
              </label>
              <div>
                <button type="button" disabled={c.busy} onClick={c.runIdempotencyDemo} style={{ border: '1px solid #ed8a2b', color: '#b85e09', borderRadius: '3px', padding: '6px 12px', fontSize: '12px', background: '#fff' }}>
                  Double-Submit Idempotency Test
                </button>
                {c.idemResult && <p className="po-cart-note" style={{ marginTop: '6px', wordBreak: 'break-word' }}>{c.idemResult}</p>}
              </div>
            </div>
          </details>
        </div>
      )}

      <p className="po-cart-note">No shipping or tax charges are added by this starter. Configure actual store policies before launch.</p>
      {c.logged ? <form className="po-address" onSubmit={e => { e.preventDefault(); c.checkout(); }}><h3>Delivery details</h3>{(['name', 'phone', 'street', 'city', 'country'] as const).map(field => <label key={field}>{field === 'name' ? 'Full name' : field === 'street' ? 'Street address' : field[0].toUpperCase() + field.slice(1)}<input disabled={c.busy || c.uncertain} required minLength={2} maxLength={200} type={field === 'phone' ? 'tel' : 'text'} autoComplete={field === 'name' ? 'name' : field === 'phone' ? 'tel' : field === 'street' ? 'street-address' : field === 'city' ? 'address-level2' : 'country-name'} value={c.address[field]} onChange={e => c.setAddress({ ...c.address, [field]: e.target.value })}/></label>)}<button className="po-orange-button" disabled={c.busy}>{c.busy ? 'Opening checkout…' : 'Proceed to checkout'}</button></form> : <Link className="po-orange-button" href="/account">Sign in to checkout →</Link>}
    </>}
    {c.message && <p className="po-form-message" role="status">{c.message}</p>}
  </section>;
}
