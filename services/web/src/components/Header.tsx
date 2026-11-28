"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';
import { useCart } from './Cart';
import { CategoryNav } from './CategoryNav';

type Panel = 'account' | 'help' | '';
export function Header() {
  const [panel, setPanel] = useState<Panel>('');
  const headerRef = useRef<HTMLElement>(null);
  const accountRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const cart = useCart();

  useEffect(() => { setPanel(''); }, [pathname]);
  useEffect(() => {
    if (!panel) return;
    function closeOutside(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setPanel('');
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        (panel === 'account' ? accountRef : helpRef).current?.focus();
        setPanel('');
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [panel]);

  function toggle(next: Exclude<Panel, ''>) { setPanel(current => current === next ? '' : next); }
  return <>
    <div className="po-announcement"><span>PayOps / DROP 01</span><strong>Your everyday. Upgraded.</strong><Link href="/products">Explore the collection <span aria-hidden="true">→</span></Link></div>
    <div className="po-utility"><div><span>From Cairo, with character.</span><span><button type="button" onClick={() => cart.setCurrency(cart.currency === 'EGP' ? 'USD' : 'EGP')} aria-label="Switch currency" style={{ fontWeight: 700, color: '#303034' }}>{cart.currency === 'USD' ? 'USD $' : 'EGP ج.م'}</button> <b>•</b> English</span></div></div>
    <header className="po-header" ref={headerRef} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPanel('');
    }}>
      <div className="po-header-inner">
        <Link className="po-logo" href="/" aria-label="PayOps home">PayOps<span className="po-logo-mark" aria-hidden="true">✳</span></Link>
        <form action="/products" role="search" className="po-search"><Icon name="search"/><input name="q" aria-label="Search products" placeholder="Search products, styles and categories"/><button type="submit">Search</button></form>
        <div className="po-header-actions">
          <button ref={accountRef} id="po-account-toggle" aria-label="Account" type="button" aria-expanded={panel === 'account'} aria-controls="po-account-dropdown" onClick={() => toggle('account')}><Icon name="user"/><span>Account</span><small aria-hidden="true">⌄</small></button>
          <button ref={helpRef} id="po-help-toggle" aria-label="Help" type="button" aria-expanded={panel === 'help'} aria-controls="po-help-dropdown" onClick={() => toggle('help')}><Icon name="help"/><span>Help</span><small aria-hidden="true">⌄</small></button>
          <Link href="/cart" aria-label={`Cart, ${cart.count} items`}><Icon name="bag"/><span>Cart</span><b className="po-cart-count">{cart.count}</b></Link>
        </div>
        <nav id="po-account-dropdown" className="po-header-panel po-account-dropdown" aria-labelledby="po-account-toggle" hidden={panel !== 'account'}>
          <h2>Your account</h2><p>Everything for your next order.</p>
          <Link className="po-dropdown-primary" href="/account" onClick={() => setPanel('')}>Sign in / Your account <span aria-hidden="true">→</span></Link>
          <Link href="/orders" onClick={() => setPanel('')}><Icon name="box"/>Your orders</Link>
          <Link href="/track" onClick={() => setPanel('')}><Icon name="truck"/>Track your order</Link>
          <Link href="/cart" onClick={() => setPanel('')}><Icon name="bag"/>Your cart</Link>
        </nav>
        <nav id="po-help-dropdown" className="po-header-panel po-help-dropdown" aria-labelledby="po-help-toggle" hidden={panel !== 'help'}>
          <h2>How can we help?</h2><p>Find your order or get to know PayOps.</p>
          <Link href="/track" onClick={() => setPanel('')}><Icon name="truck"/>Track your order</Link>
          <Link href="/orders" onClick={() => setPanel('')}><Icon name="box"/>Orders & payment status</Link>
          <Link href="/about" onClick={() => setPanel('')}><Icon name="help"/>About PayOps</Link>
          <Link href="/products" onClick={() => setPanel('')}><Icon name="search"/>Browse the collection</Link>
        </nav>
      </div>
      <CategoryNav/>
    </header>
  </>;
}
