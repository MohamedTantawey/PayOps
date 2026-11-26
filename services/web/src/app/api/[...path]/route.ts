import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
async function proxy(req:Request){
 try{
 const url=new URL(req.url);const path=url.pathname;
 // Never turn the BFF into an arbitrary network proxy.
 const allowed=/^\/api\/(checkout|marketplace\/(checkout|coupon)|refunds|webhooks\/(stripe|payops)|customer\/orders|admin\/(coupons|fulfillment|events\/retry|session|logout))$/;
 if(!allowed.test(path))return NextResponse.json({error:'Not found'},{status:404});
 const h=new Headers();for(const name of ['content-type','cookie','authorization','origin','idempotency-key','stripe-signature','x-payops-signature','x-payops-timestamp','x-payops-event','x-payops-delivery-id']){const v=req.headers.get(name);if(v)h.set(name,v);}
 h.set('x-service-token',process.env.COMMERCE_SERVICE_TOKEN||'');
 const data=req.method==='GET'?undefined:await req.arrayBuffer();if(data&&data.byteLength>1048576)return NextResponse.json({error:'Payload too large'},{status:413});
 const upstream=await fetch(`${process.env.COMMERCE_URL}${path}${url.search}`,{method:req.method,headers:h,body:data,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000)});
 const out=new Headers();for(const name of ['content-type','location','set-cookie']){const value=upstream.headers.get(name);if(value)out.set(name,value);}out.set('cache-control','no-store');
 return new Response(upstream.body,{status:upstream.status,headers:out});
 }catch{return NextResponse.json({error:'Commerce service unavailable. Retry with the same key.'},{status:503});}
}
export const GET=proxy;export const POST=proxy;
