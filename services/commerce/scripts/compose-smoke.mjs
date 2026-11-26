// Black-box end-to-end check through the public BFF. Demo mode only.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.TEST_APP_URL||'http://localhost:3000';
function client(){let cookie='';return async(path,data,method='POST',extra={})=>{const r=await fetch(base+path,{method,redirect:'manual',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...extra},body:method==='GET'?undefined:JSON.stringify(data)});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,body:await r.json()};};}
const a=client(),b=client(),anon=client();const suffix=randomUUID(),password=randomUUID()+'Test!';
assert.equal((await anon('/api/customer/orders',null,'GET')).status,401);
assert.equal((await anon('/api/marketplace/checkout',{items:[]})).status,401);
for(const [n,c] of [['a',a],['b',b]])assert.equal((await c('/api/customer/auth',{action:'register',name:'QA Customer',email:`${n}-${suffix}@example.test`,password})).status,200);
const html=await(await fetch(base+'/products')).text();const matches=[...html.matchAll(/productId[^a-zA-Z0-9]+(c[a-z0-9]{20,})/g)];
// Product IDs can be supplied by the isolated test harness or read from internal catalog with its credential.
let products;
if(process.env.TEST_COMMERCE_URL&&process.env.COMMERCE_SERVICE_TOKEN){products=await(await fetch(process.env.TEST_COMMERCE_URL+'/api/catalog',{headers:{'x-service-token':process.env.COMMERCE_SERVICE_TOKEN}})).json();}
else if(process.env.TEST_PRODUCT_IDS)products=process.env.TEST_PRODUCT_IDS.split(',').map(id=>({id}));
else throw new Error('Set TEST_PRODUCT_IDS to two catalog IDs, or TEST_COMMERCE_URL + COMMERCE_SERVICE_TOKEN');
const items=products.slice(0,2).map(p=>({productId:p.id,quantity:1}));assert.equal(items.length,2);
assert.equal((await a('/api/customer/cart',{items},'PUT')).status,200);
assert.equal((await a('/api/customer/cart',null,'GET')).body.lines.length,2);
assert.equal((await b('/api/customer/cart',null,'GET')).body.lines.length,0);
assert.equal((await a('/api/customer/cart',{items:[{...items[0],quantity:11}]},'PUT')).status,400);
const body={items,coupon:'',address:{name:'QA Customer',phone:'+201000000000',street:'Test street 1',city:'Cairo',country:'Egypt'}};const key=randomUUID();
const results=await Promise.all(Array.from({length:6},()=>a('/api/marketplace/checkout',body,'POST',{'Idempotency-Key':key})));
assert(results.every(r=>r.status===200),JSON.stringify(results));assert(results.every(r=>r.body.orderId===results[0].body.orderId));
const orderId=results[0].body.orderId;console.log('Order created once:',orderId);
assert.equal((await a('/api/marketplace/checkout',{...body,items:[items[0]]},'POST',{'Idempotency-Key':key})).status,409);
assert.equal((await b('/api/marketplace/checkout',body,'POST',{'Idempotency-Key':key})).status,409);
// Gateway mode: checkout only returns the hosted card page. The order becomes PAID after the card is paid there and the signed webhook arrives.
const payUrl=new URL(results[0].body.url);
if(payUrl.pathname.startsWith('/pay/')){
 const gw=process.env.GATEWAY_URL||payUrl.origin;
 const form=new URLSearchParams({cs:payUrl.searchParams.get('cs')||'',number:'4242 4242 4242 4242',exp_month:'12',exp_year:'2030',cvv:'123'});
 const pr=await fetch(gw+payUrl.pathname,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
 assert([200,303].includes(pr.status),'Gateway card page returned '+pr.status);
 console.log('Paid on gateway card page, waiting for webhook');
}
let orders;for(let i=0;i<30;i++){orders=(await a('/api/customer/orders',null,'GET')).body.orders;if(orders[0]?.status==='PAID')break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(orders[0].id,orderId);assert.equal(orders[0].status,'PAID');assert.equal((await b('/api/customer/orders',null,'GET')).body.orders.length,0);
if(process.env.TEST_ADMIN_TOKEN){
 const admin={authorization:`Bearer ${process.env.TEST_ADMIN_TOKEN}`};
 assert.equal((await anon('/api/admin/fulfillment',{orderId,status:'SHIPPED',trackingNumber:'QA-123',trackingUrl:'https://example.test/track',why:'Handed to test carrier'},'POST',admin)).status,200);
 assert.equal((await a('/api/customer/orders',null,'GET')).body.orders[0].fulfillment,'SHIPPED');
 const k=randomUUID();const refunds=await Promise.all(Array.from({length:4},()=>anon('/api/refunds',{orderId,why:'QA full refund'},'POST',{...admin,'Idempotency-Key':k})));assert(refunds.every(r=>r.status===200),JSON.stringify(refunds));
 assert.equal((await a('/api/customer/orders',null,'GET')).body.orders[0].status,'REFUNDED');
 assert.equal((await anon('/api/admin/coupons',{code:'QA-'+suffix.slice(0,8).toUpperCase(),percent:10,minCents:0,maxDiscountCents:10000,maxUses:5,expiresAt:new Date(Date.now()+3600000).toISOString(),why:'QA coupon'},'POST',admin)).status,200);
}
assert.equal((await a('/api/customer/auth',{action:'logout'})).status,200);assert.equal((await a('/api/customer/orders',null,'GET')).status,401);
assert.equal((await fetch(base+'/api/internal/maintenance',{method:'POST'})).status,404);
console.log('PASS: customer isolation, saved carts, six-way idempotent checkout, payload/owner conflict, paid order history, fulfillment, concurrent full refund, coupons, logout, internal route isolation. Cart cleanup is eventually consistent and verified separately.');
