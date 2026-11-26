import Link from "next/link";
export default async function CheckoutSuccessPage({searchParams}: {searchParams: Promise<{demo?: string; order?: string; session_id?: string}>}) {
  const params = await searchParams;
  const isDemo = params.demo === "1";
  const ref = params.order ?? params.session_id;
  return <section className="payops-checkout"><div className="payops-checkout-icon" aria-hidden="true">✓</div><p className="payops-eyebrow">{isDemo ? 'THE DEMO EXPERIENCE' : 'THANK YOU FOR CHOOSING PayOps'}</p><h1>{isDemo ? 'A little test run.' : "You're back from checkout."}</h1><p className="payops-checkout-copy">{isDemo ? 'This payment was simulated locally. No money was charged. The order and payment were written to the database, ready to explore in PayOps.' : 'Checkout returned successfully. Final payment status is confirmed by the payment webhook. Email receipts are not available in this project.'}</p>{ref && <p className="payops-checkout-ref">Order reference<br/>{ref}</p>}<div className="payops-checkout-actions"><Link href="/products" className="payops-button">Back to the collection <span aria-hidden="true">↗</span></Link><Link href="/track">Track your order</Link></div></section>;
}
