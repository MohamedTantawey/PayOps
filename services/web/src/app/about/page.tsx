import Link from 'next/link';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'About PayOps' };
export default function AboutPage() {
  return <div className="payops-store"><div className="po-page"><div className="po-breadcrumb"><Link href="/">Home</Link> <span>/</span> About PayOps</div><section className="po-about"><h2>PayOps. A Cairo state of mind.</h2><p>For the long days. The late nights. And everything that makes them yours. Discover our first collection of clothing, footwear and accessories, built around a little more character.</p><p>Every piece in the collection is designed by PayOps and sold by PayOps. No marketplaces, no middlemen. Just a small original catalog, fair EGP prices and a little Cairo attitude.</p><p className="po-about-note">Product images are AI-generated photographic concepts, not photographs of physical products. Promotional panels introduce the collection and do not imply a discount.</p><p className="po-about-cta"><Link href="/products">Explore the collection →</Link></p></section></div></div>;
}
