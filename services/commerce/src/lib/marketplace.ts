import { createHash } from 'crypto';
import { db } from './db';
import { financial,ApiError,Tx } from './transaction';
import { stripe,stripeConfigured } from './stripe';
import { gatewayConfigured,createGatewayPayment } from './gateway';
import { authorizePayment, settlePayment } from './payments';
export type CheckoutOptions = {
  currency?: 'EGP' | 'USD';
  paymentMethod?: string;
  captureMethod?: 'automatic' | 'manual';
  vaultToken?: string;
  simulateFailover?: boolean;
};
const EGP_PER_USD = 50;
export function convertFromEgpCents(egpCents: number, targetCurrency: 'EGP' | 'USD'): number {
  if (targetCurrency === 'USD') return Math.max(1, Math.round(egpCents / EGP_PER_USD));
  return egpCents;
}
export async function couponQuote(tx:Pick<Tx,'coupon'>,code:string,subtotal:number){if(!code)return {discountCents:0,code:null};const c=await tx.coupon.findUnique({where:{code:code.toUpperCase()}});if(!c||!c.active||c.expiresAt<new Date()||c.used>=c.maxUses||c.percent<1||c.percent>90)throw new ApiError(400,'Coupon is invalid, expired or fully used');if(subtotal<c.minCents)throw new ApiError(400,`Coupon requires a minimum of EGP ${(c.minCents/100).toFixed(2)}`);return {discountCents:Math.min(Math.floor(subtotal*c.percent/100),c.maxDiscountCents??subtotal-1),code:c.code};}
export type Address={name:string;phone:string;street:string;city:string;country:string};
export function parseAddress(value:any):Address{const out={} as Address;for(const field of ['name','phone','street','city','country'] as const){const s=typeof value?.[field]==='string'?value[field].trim():'';if(s.length<2||s.length>200)throw new ApiError(400,'Complete all delivery address fields');out[field]=s;}if(!/^\+?[\d\s()-]{7,25}$/.test(out.phone))throw new ApiError(400,'Enter a valid phone number');return out;}
export async function marketCheckout(
  key:string,
  customerId:string,
  items:{productId:string;quantity:number}[],
  code:string,
  address:Address,
  customerEmail:string,
  options: CheckoutOptions = {}
){
 const targetCurrency: 'EGP' | 'USD' = options.currency === 'USD' ? 'USD' : 'EGP';
 const paymentMethod = options.paymentMethod || (targetCurrency === 'USD' ? 'stripe_card' : 'visa');
 const captureMethod: 'automatic' | 'manual' = options.captureMethod === 'manual' ? 'manual' : 'automatic';
 const vaultToken = options.vaultToken?.trim() || undefined;
 const simulateFailover = Boolean(options.simulateFailover);
 const id=`market:${key}`;const sorted=[...items].sort((a,b)=>a.productId.localeCompare(b.productId));const fp=createHash('sha256').update(JSON.stringify({customerId,items:sorted,code,address,targetCurrency,paymentMethod,captureMethod,vaultToken:vaultToken??null,simulateFailover})).digest('hex');
 const record=await financial(async tx=>{const prev=await tx.idempotencyRecord.findUnique({where:{id}});if(prev){if(prev.fingerprint!==fp)throw new ApiError(409,'Checkout key already used for another request');return prev;}
 const owner={email:customerEmail};const products=await tx.product.findMany({where:{id:{in:items.map(i=>i.productId)},active:true}});let subtotal=0;for(const item of items){const p=products.find(p=>p.id===item.productId);if(!p)throw new ApiError(404,'A product is no longer available');if(p.currency!=='egp')throw new ApiError(400,'Cart supports EGP products only');const reserved=await tx.product.updateMany({where:{id:p.id,stock:{gte:item.quantity}},data:{stock:{decrement:item.quantity}}});if(!reserved.count)throw new ApiError(409,`Not enough stock for ${p.name}`);subtotal+=p.priceCents*item.quantity;}
 const discount=await couponQuote(tx,code,subtotal);if(discount.code)await tx.coupon.update({where:{code:discount.code},data:{used:{increment:1}}});
 const egpTotal = subtotal - discount.discountCents;
 const finalTotalCents = convertFromEgpCents(egpTotal, targetCurrency);
 const finalSubtotalCents = convertFromEgpCents(subtotal, targetCurrency);
 const finalDiscountCents = convertFromEgpCents(discount.discountCents, targetCurrency);
 const order=await tx.order.create({data:{customerId,customerEmail:owner.email,totalCents:finalTotalCents,subtotalCents:finalSubtotalCents,discountCents:finalDiscountCents,couponCode:discount.code,currency:targetCurrency.toLowerCase(),paymentMethod,captureMethod,demo:!(stripeConfigured||gatewayConfigured),shippingAddress:address,items:{create:items.map(i=>({productId:i.productId,name:products.find(p=>p.id===i.productId)!.name,quantity:i.quantity,unitCents:convertFromEgpCents(products.find(p=>p.id===i.productId)!.priceCents, targetCurrency)}))}}});const expires=Math.floor(Date.now()/1000)+35*60;await tx.reservation.createMany({data:items.map(i=>({orderId:order.id,productId:i.productId,quantity:i.quantity,expiresAt:new Date(expires*1000)}))});return tx.idempotencyRecord.create({data:{id,fingerprint:fp,context:{orderId:order.id,totalCents:order.totalCents,currency:targetCurrency,email:owner.email,expires,names:items.map(i=>`${products.find(p=>p.id===i.productId)!.name} × ${i.quantity}`).join(', ')}}});});
 if(record.response)return record.response;const ctx=record.context as unknown as {orderId:string;totalCents:number;currency?:string;email:string;expires:number;names:string};const origin=process.env.NEXT_PUBLIC_APP_URL||'http://localhost:3000';let url=`${origin}/checkout/success?demo=1&order=${ctx.orderId}`,sessionId:string|undefined,paymentStatus:string|undefined,routedConnector:string|null=null,routingSummary:string|null=null;
 const gwCurrency = (ctx.currency || targetCurrency).toUpperCase();
 if(gatewayConfigured){if(Date.now()-record.createdAt.getTime()>23*3600000)throw new ApiError(409,'Checkout expired. Contact store support before retrying with a new key.');const payment=await createGatewayPayment({orderId:ctx.orderId,amountCents:ctx.totalCents,currency:gwCurrency,description:ctx.names.slice(0,200),customerEmail:ctx.email,returnUrl:`${origin}/checkout/success?order=${ctx.orderId}`,cancelUrl:`${origin}/checkout/cancel`,idemKey:id,captureMethod,vaultToken,confirm:Boolean(vaultToken),autoInvoice:true,paymentMethod,simulateFailover});url=vaultToken?`${origin}/checkout/success?order=${ctx.orderId}`:payment.url;sessionId=payment.intentId;paymentStatus=payment.status;routedConnector=payment.routedConnector;routingSummary=payment.routingSummary;}else if(stripe){if(Date.now()-record.createdAt.getTime()>23*3600000||ctx.expires<Date.now()/1000+1800)throw new ApiError(409,'Checkout expired. Contact store support before retrying with a new key.');const session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],customer_email:ctx.email,expires_at:ctx.expires,line_items:[{quantity:1,price_data:{currency:gwCurrency.toLowerCase(),unit_amount:ctx.totalCents,product_data:{name:'PayOps order',description:ctx.names.slice(0,500)}}}],metadata:{orderId:ctx.orderId},success_url:`${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/checkout/cancel`},{idempotencyKey:id});if(!session.url)throw new Error('Checkout URL unavailable');url=session.url;sessionId=session.id;}
 return financial(async tx=>{const current=await tx.idempotencyRecord.findUniqueOrThrow({where:{id}});if(current.response)return current.response;if(sessionId){await tx.order.update({where:{id:ctx.orderId},data:{stripeSessionId:sessionId,...(routedConnector?{routedConnector}:{}),...(routingSummary?{routingSummary}:{})}});if(paymentStatus==='succeeded'){await settlePayment(tx,ctx.orderId,ctx.email,sessionId,{routedConnector,routingSummary});}else if(paymentStatus==='requires_capture'){await authorizePayment(tx,ctx.orderId,sessionId,{routedConnector,routingSummary});}}else await settlePayment(tx,ctx.orderId,ctx.email);const response={url,orderId:ctx.orderId};await tx.idempotencyRecord.update({where:{id},data:{response}});return response;});
}
