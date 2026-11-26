// Synthetic signatures and local OTLP receiver only. Use an isolated seeded test DB. Starts its own app on port 3101.
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../package.json', import.meta.url));const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
let tracePosts=0;
const collector=createServer((req,res)=>{if(req.url==='/v1/traces')tracePosts++;req.resume();res.end('{}');});await new Promise(r=>collector.listen(0,'127.0.0.1',r));
const env={...process.env,PORT:'3101',DATABASE_URL:process.env.DATABASE_URL,NEXT_PUBLIC_APP_URL:'http://localhost:3101',STRIPE_SECRET_KEY:'sk_test_local_fake_no_provider_calls',STRIPE_WEBHOOK_SECRET:'whsec_local_synthetic_test',OTEL_EXPORTER_OTLP_ENDPOINT:`http://127.0.0.1:${collector.address().port}`,OTEL_SERVICE_NAME:'payops-test',OTEL_BSP_SCHEDULE_DELAY:'500'};
const server=spawn('node',['node_modules/next/dist/bin/next','start','-p','3101'],{cwd:process.cwd(),env,stdio:'inherit'});
async function webhook(event){const body=JSON.stringify(event),t=Math.floor(Date.now()/1000);return fetch('http://localhost:3101/api/webhooks/stripe',{method:'POST',headers:{'x-service-token':process.env.COMMERCE_SERVICE_TOKEN,'stripe-signature':`t=${t},v1=${createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(t+'.'+body).digest('hex')}`},body});}
try{
 for(let i=0;i<60;i++){try{if((await fetch('http://localhost:3101/metrics')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 const product=await db.product.findFirstOrThrow();
 const order=await db.order.create({data:{totalCents:12300,currency:'egp',demo:false}});
 await db.product.update({where:{id:product.id},data:{stock:{decrement:1}}});
 await db.reservation.create({data:{orderId:order.id,productId:product.id,quantity:1,expiresAt:new Date(Date.now()+10000)}});
 const event={id:'evt_signed_'+randomUUID(),type:'checkout.session.completed',data:{object:{payment_status:'paid',amount_total:12300,currency:'egp',payment_intent:'pi_local_'+randomUUID(),metadata:{orderId:order.id}}}};
 const responses=await Promise.all(Array.from({length:8},()=>webhook(event)));assert(responses.every(r=>r.status===200));
 assert.equal(await db.payment.count({where:{orderId:order.id}}),1);assert.equal(await db.ledgerEntry.count({where:{orderId:order.id}}),2);
 assert.equal((await db.reservation.findFirstOrThrow({where:{orderId:order.id}})).state,'COMMITTED');
 assert.equal(await db.webhookDelivery.count({where:{eventId:event.id}}),8);
 const expired=await db.order.create({data:{totalCents:100,demo:false}});await db.reservation.create({data:{orderId:expired.id,productId:product.id,quantity:1,expiresAt:new Date(0)}});await db.product.update({where:{id:product.id},data:{stock:{decrement:1}}});
 const exp={id:'evt_expired_'+randomUUID(),type:'checkout.session.expired',data:{object:{metadata:{orderId:expired.id}}}};
 assert.equal((await webhook(exp)).status,200);assert.equal((await webhook(exp)).status,200);assert.equal((await db.reservation.findFirstOrThrow({where:{orderId:expired.id}})).state,'RELEASED');
 const late={...event,id:'evt_late_'+randomUUID(),data:{object:{...event.data.object,amount_total:100,metadata:{orderId:expired.id}}}};
 assert.equal((await webhook(late)).status,503);assert.equal(await db.payment.count({where:{orderId:expired.id}}),0);
 for(let i=0;i<20&&tracePosts===0;i++)await new Promise(r=>setTimeout(r,250));assert(tracePosts>0,'OTLP exporter received no traces');
 console.log('PASS: signed webhook concurrent redelivery, delivery receipts, one payment/ledger commit, session expiration replay, late-paid inventory review, OpenTelemetry OTLP HTTP export to local test collector.');
}finally{server.kill('SIGTERM');await new Promise(r=>server.on('exit',r));collector.close();await db.$disconnect();}
