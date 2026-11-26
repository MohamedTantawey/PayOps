import http from 'node:http';
import {randomBytes,createHash,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();const scrypt=promisify(scryptCb);const digest=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>65536)throw fail(413,'Payload too large');}try{return JSON.parse(data||'{}');}catch{throw fail(400,'Invalid JSON');}}
async function customer(req){const token=req.headers['x-session-token'];if(!token)return null;const session=await db.customerSession.findUnique({where:{id:digest(token)},include:{customer:true}});const c=session&&session.expiresAt>new Date()?session.customer:null;return c?{id:c.id,email:c.email,name:c.name}:null;}
const publicCustomer=c=>({id:c.id,email:c.email,name:c.name});
async function route(req){const path=new URL(req.url,'http://identity').pathname;
 if(path==='/health'){await db.$queryRaw`SELECT 1`;return {ok:true,service:'identity',version:'2.0.0'};}
 const key=process.env.IDENTITY_SERVICE_TOKEN;if(!key||key.length<32||!equal(req.headers.authorization,`Bearer ${key}`))throw fail(401,'Service authentication required');
 if(req.method==='GET'&&path==='/v1/session')return {customer:await customer(req)};
 if(req.method==='POST'&&path==='/v1/auth'){
  const b=await body(req);if(b.action==='logout'){const token=req.headers['x-session-token'];if(token)await db.customerSession.deleteMany({where:{id:digest(token)}});return {ok:true,logout:true};}
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';const password=b.password;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<10||password.length>128)throw fail(400,'Use a valid email and a password of 10-128 characters');
  const id=digest(email);const resetAt=new Date(Date.now()+900000);const attempt=await db.authAttempt.upsert({where:{id},create:{id,count:1,resetAt},update:{count:{increment:1}}});if(attempt.resetAt<new Date())await db.authAttempt.update({where:{id},data:{count:1,resetAt}});else if(attempt.count>12)throw fail(429,'Too many attempts. Try again in 15 minutes.');
  let c;
  if(b.action==='register'){const name=typeof b.name==='string'?b.name.trim():'';if(name.length<2||name.length>80)throw fail(400,'Enter a name of 2-80 characters');const salt=randomBytes(16).toString('hex');const hash=`${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;try{c=await db.customer.create({data:{email,name,passwordHash:hash}});}catch(e){if(e.code==='P2002')throw fail(409,'Unable to create account. Try signing in instead.');throw e;}}
  else if(b.action==='login'){c=await db.customer.findUnique({where:{email}});const [salt,key]=(c?.passwordHash||'00000000000000000000000000000000:'+ '00'.repeat(64)).split(':');const derived=await scrypt(password,salt,64);if(!c||!equal(derived,Buffer.from(key,'hex')))throw fail(401,'Email or password is incorrect');}
  else throw fail(400,'Unknown action');
  const token=randomBytes(32).toString('base64url');await db.customerSession.create({data:{id:digest(token),customerId:c.id,expiresAt:new Date(Date.now()+7*86400000)}});return {customer:publicCustomer(c),sessionToken:token};
 }
 if(path==='/v1/cart'){
  const c=await customer(req);if(!c)throw fail(401,'Sign in to continue');
  if(req.method==='GET')return {items:await db.cartItem.findMany({where:{customerId:c.id},select:{productId:true,quantity:true}})};
  if(req.method==='PUT'){const {items}=await body(req);if(!Array.isArray(items)||items.length>50||items.some(x=>typeof x.productId!=='string'||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>10)||new Set(items.map(x=>x.productId)).size!==items.length)throw fail(400,'Invalid cart');await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.id}))`;await tx.cartItem.deleteMany({where:{customerId:c.id}});if(items.length)await tx.cartItem.createMany({data:items.map(x=>({...x,customerId:c.id}))});});return {ok:true};}
 }
 if(path==='/v1/events/cart-purchased'&&req.method==='POST'){
  const event=await body(req);if(typeof event.id!=='string'||typeof event.customerId!=='string'||!Array.isArray(event.items)||event.items.some(x=>typeof x.productId!=='string'||!Number.isInteger(x.quantity)||x.quantity<1))throw fail(400,'Invalid event');
  await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${event.customerId}))`;if(await tx.inbox.findUnique({where:{id:event.id}}))return;for(const item of event.items){const saved=await tx.cartItem.findUnique({where:{customerId_productId:{customerId:event.customerId,productId:item.productId}}});if(!saved)continue;if(saved.quantity<=item.quantity)await tx.cartItem.delete({where:{id:saved.id}});else await tx.cartItem.update({where:{id:saved.id},data:{quantity:{decrement:item.quantity}}});}await tx.inbox.create({data:{id:event.id}});});return {ok:true};
 }
 throw fail(404,'Route not found');
}
const server=http.createServer(async(req,res)=>{try{const data=await route(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}catch(e){if(!e.status)console.error('Identity request failed',e.code||'unknown');res.writeHead(e.status||503,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'Identity service unavailable'}));}});
server.listen(Number(process.env.PORT||3200),'0.0.0.0');
process.on('SIGTERM',()=>server.close(async()=>{await db.$disconnect();process.exit(0);}));
