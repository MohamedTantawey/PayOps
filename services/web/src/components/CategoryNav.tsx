import Link from 'next/link';
import { Icon } from './Icon';

export const SHOP_CATEGORIES = [
  { label: 'All products', icon: 'grid' },
  { label: 'Clothing', icon: 'shirt' },
  { label: 'Footwear', icon: 'shoe' },
  { label: 'Accessories', icon: 'cap' },
];

export function categoryHref(label: string) {
  return label === 'All products' ? '/products' : `/products?cat=${encodeURIComponent(label)}`;
}

export function CategoryNav() {
  return <nav className="po-category-nav" aria-label="Shop by category">
    {SHOP_CATEGORIES.map(c => <Link key={c.label} href={categoryHref(c.label)}><Icon name={c.icon}/>{c.label}</Link>)}
    <Link className="po-nav-extra" href="/track"><Icon name="bag"/>Track your order</Link>
    <Link className="po-nav-extra" href="/about">About PayOps</Link>
  </nav>;
}
