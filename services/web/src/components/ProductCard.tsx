"use client";
import Link from 'next/link';
import {formatMoney} from '@/lib/money';
import type {StoreProduct} from '@/lib/demo';
import {BuyButton} from './BuyButton';
import {ProductArt} from './ProductArt';
import {useCart} from './Cart';
export function ProductCard({product:p}:{product:StoreProduct}){const cart=useCart();return <article className="payops-product"><Link className={`payops-product-well well-${p.slug}`} href={`/products/${p.slug}`} aria-label={`View ${p.name}`}><span className="payops-product-label">PayOps ORIGINAL</span><ProductArt slug={p.slug} name={p.name}/><span className="payops-art-note">AI concept</span></Link><div className="po-product-info"><h3><Link href={`/products/${p.slug}`}>{p.name}</Link></h3><strong>{formatMoney(p.priceCents,p.currency)}</strong><p className="payops-product-description">{p.description}</p><span className="po-stock"><i/>{p.stock>0?'In stock':'Sold out'}</span><button className="po-add-button" disabled={p.stock<=0||!cart.ready} onClick={()=>cart.add(p)}>Add to cart</button><BuyButton productId={p.id} disabled={p.stock<=0}/></div></article>;}
