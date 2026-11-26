"use client";
import Link from 'next/link';
import type { StoreProduct } from '@/lib/demo';
import { productCategory } from '@/lib/demo';
import { formatMoney } from '@/lib/money';
import { ProductArt } from './ProductArt';
import { ProductCard } from './ProductCard';
import { BuyButton } from './BuyButton';
import { Icon } from './Icon';
import { useCart } from './Cart';

export function ProductDetail({ product: p, related }: { product: StoreProduct; related: StoreProduct[] }) {
  const cart = useCart();
  return <>
    <section className="po-detail">
      <div className="po-detail-gallery payops-product-well"><span className="payops-product-label">PayOps ORIGINAL</span><ProductArt slug={p.slug} name={p.name}/><span className="payops-art-note">AI concept</span></div>
      <div className="po-detail-info">
        <p className="po-detail-cat">{productCategory(p.slug)}</p>
        <h1>{p.name}</h1>
        <strong className="po-detail-price">{formatMoney(p.priceCents, p.currency)}</strong>
        <p className="po-detail-desc">{p.description}</p>
        <span className="po-stock"><i/>{p.stock > 0 ? `In stock (${p.stock} available)` : 'Sold out'}</span>
        <div className="po-detail-actions">
          <button className="po-add-button" disabled={p.stock <= 0 || !cart.ready} onClick={() => cart.add(p)}>Add to cart</button>
          <BuyButton productId={p.id} disabled={p.stock <= 0}/>
        </div>
        <ul className="po-detail-meta">
          <li><span>Category</span>{productCategory(p.slug)}</li>
          <li><span>Reference</span>{p.slug}</li>
          <li><span>Prices</span>All prices in EGP</li>
        </ul>
        <p className="po-detail-note">Product image is an AI-generated photographic concept, not a photograph of a physical product.</p>
      </div>
    </section>
    {related.length > 0 && <section className="po-related"><header className="po-section-bar"><h2><Icon name="grid"/>You may also like</h2><Link href="/products">See all <span>›</span></Link></header><div className="payops-product-grid po-related-grid">{related.map(r => <ProductCard product={r} key={r.id}/>)}</div></section>}
  </>;
}
