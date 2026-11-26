import {gatewayConfigured} from '@/lib/gateway';
import {NextResponse} from 'next/server';import {db} from '@/lib/db';import {requireRole,sameOrigin} from '@/lib/auth';import {failure} from '@/lib/http';import {ledgerBalances} from '@/lib/ledger';
export async function GET(req:Request,{params}:{params:Promise<{view:string}>}){try{
const {view}=await params;await requireRole(['ledger','coupons'].includes(view)?['finance']:view==='audit'?[]:['ops','finance']);
let data:unknown;
switch(view){
case 'stats':data={orderCount:await db.order.count(),balances:await ledgerBalances(),stripeConfigured:(!!process.env.STRIPE_SECRET_KEY&&!process.env.STRIPE_SECRET_KEY.includes('REPLACE_ME'))||gatewayConfigured,gateway:gatewayConfigured};break;
case 'orders':data=await db.order.findMany({orderBy:{createdAt:'desc'},take:50,include:{items:true,refunds:true,payments:true}});break;
case 'ledger':data={balances:await ledgerBalances(),entries:await db.ledgerEntry.findMany({take:100,orderBy:{createdAt:'desc'}})};break;
case 'events':data=await db.webhookEvent.findMany({take:100,orderBy:{updatedAt:'desc'}});break;
case 'deliveries':data=await db.webhookDelivery.findMany({take:30,orderBy:{receivedAt:'desc'}});break;
case 'audit':data=await db.auditLog.findMany({take:200,orderBy:{createdAt:'desc'}});break;
case 'coupons':data=await db.coupon.findMany({take:100,orderBy:{expiresAt:'desc'}});break;
default:return NextResponse.json({error:'Not found'},{status:404});}
return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:{params:Promise<{view:string}>}){try{sameOrigin(req);const {view}=await params;if(view!=='audit')return NextResponse.json({error:'Not found'},{status:404});const actor=await requireRole(['ops','finance']);const {target}=await req.json();await db.auditLog.create({data:{actor:actor.name,role:actor.role,action:'view',target:String(target).slice(0,100),why:'Requested admin page'}});return NextResponse.json({ok:true});}catch(e){return failure(e);}}
