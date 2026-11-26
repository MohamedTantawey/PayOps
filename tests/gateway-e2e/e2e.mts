import {PGlite} from '@electric-sql/pglite';import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {spawn} from 'node:child_process';const execFileSync=(c:string,a:string[],o:any)=>new Promise<void>((res,rej)=>{const ch=spawn(c,a,o);ch.on('exit',code=>code===0?res():rej(new Error(c+' '+a.join(' ')+' exit '+code)));});import http from 'node:http';import assert from 'node:assert/strict';
const pg=await PGlite.create();const sock=new PGLiteSocketServer({db:pg,port:5544,host:'127.0.0.1'});await sock.start();
process.env.DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5544/postgres?connection_limit=1&pool_timeout=60';
await execFileSync('npx',['prisma','db','push','--skip-generate','--accept-data-loss'],{stdio:'inherit'});
await execFileSync('npx',['prisma','db','execute','--file','prisma/sql/ledger-constraints.sql','--schema','prisma/schema.prisma'],{stdio:'inherit'});
// gateway
const {createApp}=await import('../../services/gateway/src/server.js');
const KEY='sk_test_e2e_aaaaaaaaaaaaaaaaaaaaaaaa',WH='whsec_test_e2e_aaaaaaaaaaaaaaaaaaaaaaaa';
let hookRoute:any;let hookStatuses:number[]=[];
const fwd=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',async()=>{const r=await hookRoute.POST(new Request('http://c/api/webhooks/payops',{method:'POST',headers:req.headers as any,body:b}));hookStatuses.push(r.status);res.writeHead(r.status);res.end('x');});});
await new Promise<void>(r=>fwd.listen(0,r));
const gw=await createApp({env:{GATEWAY_TEST_KEY:KEY,GATEWAY_WEBHOOK_TARGET:`http://127.0.0.1:${(fwd.address() as any).port}/h`,GATEWAY_WEBHOOK_SECRET:WH} as any,tickMs:200});
await new Promise<void>(r=>gw.server.listen(0,r));const GW=`http://127.0.0.1:${(gw.server.address() as any).port}`;
Object.assign(process.env,{GATEWAY_URL:GW,GATEWAY_API_KEY:KEY,GATEWAY_WEBHOOK_SECRET:WH,GATEWAY_PUBLIC_URL:GW,NEXT_PUBLIC_APP_URL:'http://localhost:3000',IDENTITY_URL:'http://127.0.0.1:9',IDENTITY_SERVICE_TOKEN:'x'});
const {db}=await import('@/lib/db');const pay=await import('@/lib/payments');const wh=await import('@/lib/webhooks');const mk=await import('@/lib/marketplace');
hookRoute=await import('@/app/api/webhooks/payops/route');
const wait=async(fn:()=>Promise<any>,ms=15000)=>{const e=Date.now()+ms;while(Date.now()<e){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,200));}throw new Error('timeout');};
const product=await db.product.create({data:{name:'Test Tee',slug:'test-tee',description:'d',priceCents:65000,stock:10,emoji:'x',gradient:'g'}});
const actor={name:'t',role:'finance'} as any;
const payForm=async(url:string,num:string)=>{const u=new URL(url);const cs=u.searchParams.get('cs')!;return fetch(GW+u.pathname,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({cs,number:num,exp_month:'12',exp_year:'2030',cvv:'123'})});};

// 1) checkout -> gateway page
const key='k'.repeat(20)+'1';
const c=await pay.checkout(key,product.id,2) as any;
assert(c.url.startsWith(GW+'/pay/'),c.url);
let o=await db.order.findUniqueOrThrow({where:{id:c.orderId}});assert.equal(o.status,'PENDING');assert.equal(o.demo,false);assert(o.stripeSessionId);assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).stock,8);
const again=await pay.checkout(key,product.id,2) as any;assert.equal(again.url,c.url,'idempotent replay');
let html=await (await fetch(c.url)).text();assert(html.includes('1300.00 egp')||html.includes('1300.00 EGP'),'amount on page');
// 2) declined card then good card
let r=await payForm(c.url,'4000000000000002');assert.equal(r.status,402);
o=await db.order.findUniqueOrThrow({where:{id:c.orderId}});assert.equal(o.status,'PENDING');
r=await payForm(c.url,'4242424242424242');assert.equal(r.status,303);assert(r.headers.get('location')!.startsWith('http://localhost:3000/checkout/success?order='+c.orderId));
o=await wait(async()=>{const x=await db.order.findUniqueOrThrow({where:{id:c.orderId}});return x.status==='PAID'&&x;});
assert.equal(o.stripePaymentIntent,o.stripeSessionId);assert.equal(await db.payment.count({where:{orderId:o.id}}),1);
assert.equal((await db.reservation.findFirstOrThrow({where:{orderId:o.id}})).state,'COMMITTED');
const led=await db.ledgerEntry.findMany({where:{orderId:o.id}});assert.equal(led.reduce((a,e)=>a+e.debitCents-e.creditCents,0),0);
console.log('OK paid via gateway webhook');
// 3) replay/duplicate webhook is harmless; bad signature rejected
const dl=await (await fetch(GW+'/api/webhooks/deliveries?limit=5',{headers:{Authorization:'Bearer '+KEY}})).json();
await fetch(GW+`/api/webhooks/deliveries/${dl.items.find((d:any)=>d.event_type==='payment.succeeded').id}/replay`,{method:'POST',headers:{Authorization:'Bearer '+KEY}});
await new Promise(r=>setTimeout(r,1500));assert.equal(await db.payment.count({where:{orderId:o.id}}),1);
const bad=await hookRoute.POST(new Request('http://c/x',{method:'POST',headers:{'x-payops-timestamp':String(Math.floor(Date.now()/1000)),'x-payops-signature':'t=1,v1=00'},body:'{"id":"e","event_type":"payment.succeeded"}'}));assert.equal(bad.status,400);
console.log('OK replay + bad signature');
// 4) refund
const rf=await pay.refund('r'.repeat(20)+'1',o.id,'customer asked',actor) as any;assert.equal(rf.refunded,true);
o=await db.order.findUniqueOrThrow({where:{id:o.id}});assert.equal(o.status,'REFUNDED');
await new Promise(r=>setTimeout(r,1800));assert.equal(await db.refund.count({where:{orderId:o.id}}),1);assert.equal(await db.refund.count({where:{orderId:o.id,status:'succeeded'}}),1);
const led2=await db.ledgerEntry.findMany({where:{orderId:o.id}});assert.equal(led2.reduce((a,e)=>a+e.debitCents-e.creditCents,0),0);
const g=await (await fetch(GW+'/api/payments/'+o.stripePaymentIntent,{headers:{Authorization:'Bearer '+KEY}})).json();assert.equal(g.intent.amount_refunded_cents,130000);
console.log('OK refund');
// 5) abandoned checkout -> maintenance cancels at gateway and releases stock
const c2=await pay.checkout('z'.repeat(20)+'2',product.id,1) as any;
const stock0=(await db.product.findUniqueOrThrow({where:{id:product.id}})).stock;
await db.reservation.updateMany({where:{orderId:c2.orderId},data:{expiresAt:new Date(0)}});
await wh.maintenance();
assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).stock,stock0+1);assert.equal((await db.order.findUniqueOrThrow({where:{id:c2.orderId}})).status,'CANCELED');
const o2=await db.order.findUniqueOrThrow({where:{id:c2.orderId}});
const g2=await (await fetch(GW+'/api/payments/'+o2.stripeSessionId,{headers:{Authorization:'Bearer '+KEY}})).json();assert.equal(g2.intent.status,'canceled');
const late=await payForm(c2.url,'4242424242424242');assert(late.status!==303||new URL(late.headers.get('location')!).searchParams.get('status')==='canceled');
console.log('OK expiry');
// 6) paid but webhook missed: maintenance reconciles
const c3=await pay.checkout('y'.repeat(20)+'3',product.id,1) as any;
hookStatuses=[];(gw as any);await db.webhookEvent.deleteMany({});
// stop webhooks by pointing endpoint nowhere
await gw.db.query("UPDATE webhook_endpoints SET target_url='http://127.0.0.1:9/none'");
await payForm(c3.url,'4242424242424242');
await db.reservation.updateMany({where:{orderId:c3.orderId},data:{expiresAt:new Date(0)}});
await wh.maintenance();
assert.equal((await db.order.findUniqueOrThrow({where:{id:c3.orderId}})).status,'PAID');
console.log('OK missed-webhook reconcile');
await gw.db.query('UPDATE webhook_endpoints SET target_url=$1',[`http://127.0.0.1:${(fwd.address() as any).port}/h`]);
// 7) marketplace checkout
const cust={id:'cust_e2e'};
if(cust){const m=await mk.marketCheckout('m'.repeat(20)+'4',cust.id,[{productId:product.id,quantity:1}],'',{name:'Aa',phone:'+201000000000',street:'12 Street',city:'Cairo',country:'Egypt'},'a@b.co') as any;assert(m.url.startsWith(GW+'/pay/'));const mo=await db.order.findUniqueOrThrow({where:{id:m.orderId}});assert.equal(mo.demo,false);assert.equal(mo.customerEmail,'a@b.co');const pr=await payForm(m.url,'4000000000000341');assert.equal(pr.status,303);await wait(async()=>(await db.order.findUniqueOrThrow({where:{id:m.orderId}})).status==='PAID');console.log('OK marketCheckout');}else console.log('SKIP marketCheckout (no customer model)');
console.log('ALL PASS');process.exit(0);
