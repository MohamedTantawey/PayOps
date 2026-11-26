"use client";
import { useState } from 'react';
import Link from 'next/link';
import type { StoreProduct } from '@/lib/demo';
import { formatMoney } from '@/lib/money';
import { ProductArt } from './ProductArt';
import { Icon } from './Icon';
import { SHOP_CATEGORIES, categoryHref } from './CategoryNav';

export function Home({ products }: { products: StoreProduct[] }) {
  const [slide, setSlide] = useState(0);
  const hero = products.find(p => p.slug.includes(slide === 1 ? 'sneaker' : 'hoodie')) || products[0];
  const featured = products.slice(0, 3);
  return <div className="payops-store"><div className="po-page">
    <section className="po-hero-grid">
      <aside className="po-category-menu"><h2>Shop by category</h2>{SHOP_CATEGORIES.map(c => <Link key={c.label} href={categoryHref(c.label)}><Icon name={c.icon}/>{c.label}<span>›</span></Link>)}<div className="po-sidebar-note"><span>THE FIRST DROP</span><strong>Small collection.<br/>Big character.</strong><p>Six everyday pieces.<br/>One Cairo state of mind.</p></div></aside>
      <div className={`po-promo-hero po-slide-${slide}`}><div className="po-promo-copy"><span className="po-promo-tag">PayOps STUDIO • DROP 01</span><h1>{slide === 0 ? <>Everyday style.<br/><em>Anything but ordinary.</em></> : <>Go your own way.<br/><em>From the ground up.</em></>}</h1><p>{slide === 0 ? 'Your new rotation starts here.' : 'Meet the Nebula Sneakers.'}</p><Link className="po-hero-cta" href={slide === 0 ? '/products' : '/products?cat=Footwear'}>Shop the collection <span>→</span></Link><small>Original PayOps collection • Prices in EGP</small></div><div className="po-hero-art">{hero && <ProductArt slug={hero.slug} name={hero.name}/>}<span className="po-hero-orbit">PayOps<br/><b>01</b></span></div><div className="po-slider-controls"><button aria-label="Show everyday collection banner" aria-pressed={slide === 0} onClick={() => setSlide(0)}/><button aria-label="Show footwear banner" aria-pressed={slide === 1} onClick={() => setSlide(1)}/></div></div>
      <aside className="po-hero-side"><Link href="/account"><Icon name="user"/><div><strong>Make it yours</strong><p>Sign in & save your cart</p></div><span>›</span></Link><Link href="/track"><Icon name="bag"/><div><strong>Follow your order</strong><p>Payment to delivery</p></div><span>›</span></Link><Link className="po-mini-promo" href="/products?cat=Accessories"><span>THE FINISHING TOUCH</span><strong>Good details.<br/>Better days.</strong><span>Explore accessories →</span><div><ProductArt slug="orbit-cap" name="Orbit Cap"/></div></Link></aside>
    </section>
    <section className="po-quick-categories" aria-label="Collection shortcuts">{products.map(p => <Link key={p.id} href={`/products/${p.slug}`}><div><ProductArt slug={p.slug} name={p.name}/></div><span>{p.name}</span></Link>)}</section>
    <section className="po-featured"><header className="po-section-bar"><h2><Icon name="grid"/>This week's highlights</h2><Link href="/products">Shop all <span>›</span></Link></header><div className="po-featured-grid">{featured.map(p => <Link key={p.id} href={`/products/${p.slug}`}><div className="po-featured-art"><ProductArt slug={p.slug} name={p.name}/></div><strong>{p.name}</strong><span>{formatMoney(p.priceCents, p.currency)}</span><em>View product →</em></Link>)}</div></section>
    <section className="po-bottom-promos"><Link href="/products?cat=Clothing"><div><small>YOUR DAILY UNIFORM</small><h2>Good pieces.<br/>On repeat.</h2><span>Explore clothing →</span></div><ProductArt slug="pulse-tee" name="Pulse Tee"/></Link><Link href="/products?cat=Accessories"><div><small>READY FOR EVERY DAY</small><h2>Take your world<br/>with you.</h2><span>Explore accessories →</span></div><ProductArt slug="echo-backpack" name="Echo Backpack"/></Link></section>
    <section className="po-about"><h2>PayOps. A Cairo state of mind.</h2><p>For the long days. The late nights. And everything that makes them yours. Discover our first collection of clothing, footwear and accessories, built around a little more character.</p><p><Link href="/about">More about PayOps →</Link></p></section>
  </div></div>;
}
