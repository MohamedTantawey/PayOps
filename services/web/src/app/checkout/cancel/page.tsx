import Link from "next/link";
export default function CheckoutCancelPage() {
  return <section className="payops-checkout"><div className="payops-checkout-icon" aria-hidden="true">↶</div><p className="payops-eyebrow">NO RUSH. FIND YOUR RHYTHM.</p><h1>Take your time.</h1><p className="payops-checkout-copy">You left checkout before completing your order. Come back to the collection whenever you're ready.</p><div className="payops-checkout-actions"><Link href="/products" className="payops-button">Back to the collection <span aria-hidden="true">↗</span></Link></div></section>;
}
