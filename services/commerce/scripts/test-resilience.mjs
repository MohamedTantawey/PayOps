// Isolated local test harness only. Requires TEST_IDENTITY_PID for controlled outage.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PrismaClient} from '@prisma/client';
const keepAlive=setInterval(()=>{},1000);const db=new PrismaClient();const web=process.env.TEST_WEB_URL||'http://localhost:3000',commerce=process.env.TEST_COMMERCE_URL||'http://localhost:3100',identity=process.env.IDENTITY_URL;
const headers={'x-service-token':process.env.COMMERCE_SERVICE_TOKEN};
async function maintenance(){return fetch(commerce+'/api/internal/maintenance',{method:'POST',headers:{...headers,authorization:`Bearer ${process.env.MAINTENANCE_TOKEN}`}});}
try{
 assert.equal((await fetch(commerce+'/api/catalog')).status,401);
 assert.equal((await fetch(identity+'/v1/session')).status,401);
 assert.equal((await fetch(web+'/api/views/orders')).status,404);
 assert.equal((await fetch(web+'/api/customer/auth',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'})).status,403);
 const email=`outbox-${randomUUID()}@example.test`;const auth=await fetch(web+'/api/customer/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'register',name:'Outbox QA',email,password:randomUUID()})});assert.equal(auth.status,200);const cookie=auth.headers.get('set-cookie').split(';')[0];
 const customer=(await auth.json()).customer;const product=await db.product.findFirstOrThrow();
 assert.equal((await fetch(web+'/api/customer/cart',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({items:[{productId:product.id,quantity:2}]})})).status,200);
 const checkout=await fetch(web+'/api/marketplace/checkout',{method:'POST',headers:{cookie,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({items:[{productId:product.id,quantity:1}],coupon:'',address:{name:'QA Customer',phone:'+201000000000',street:'Test street 1',city:'Cairo',country:'Egypt'}})});assert.equal(checkout.status,200);const {orderId}=await checkout.json();
 const message=await db.outbox.findUniqueOrThrow({where:{id:`cart:${orderId}`}});assert.equal(message.deliveredAt,null);assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).status,'PAID');
 // The shell harness stops Identity only after this marker, then resumes this test.
 console.log('AWAIT_IDENTITY_DOWN',orderId);
 await new Promise(resolve=>{process.once('SIGUSR1',resolve);});
 const failed=await maintenance();assert.equal(failed.status,200);const pending=await db.outbox.findUniqueOrThrow({where:{id:message.id}});assert.equal(pending.deliveredAt,null);assert(pending.attempts>0);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).status,'PAID');assert.equal(await db.payment.count({where:{orderId}}),1);
 const home=await fetch(web);assert.equal(home.status,200);const account=await fetch(web+'/api/customer/auth',{headers:{cookie}});assert.equal(account.status,503);
 console.log('AWAIT_IDENTITY_UP');await new Promise(resolve=>{process.once('SIGUSR1',resolve);});
 assert.equal((await maintenance()).status,200);assert((await db.outbox.findUniqueOrThrow({where:{id:message.id}})).deliveredAt);
 let cart=await(await fetch(web+'/api/customer/cart',{headers:{cookie}})).json();assert.equal(cart.lines.find(x=>x.product.id===product.id).quantity,1);
 // Repeat exact event delivery directly to the authenticated inbox, simulating lost ACK.
 const replay=await fetch(identity+'/v1/events/cart-purchased',{method:'POST',headers:{authorization:`Bearer ${process.env.IDENTITY_SERVICE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({id:message.id,...message.payload})});assert.equal(replay.status,200);
 cart=await(await fetch(web+'/api/customer/cart',{headers:{cookie}})).json();assert.equal(cart.lines.find(x=>x.product.id===product.id).quantity,1);
 console.log('PASS: service authentication, BFF allowlist/origin checks, Identity outage leaves paid order/ledger intact, storefront still renders, outbox retains failure, recovery delivers cart cleanup, inbox ignores duplicate delivery.');
}finally{clearInterval(keepAlive);await db.$disconnect();}
