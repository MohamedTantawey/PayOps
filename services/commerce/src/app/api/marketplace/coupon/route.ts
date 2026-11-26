import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {sameOrigin} from '@/lib/auth';
import {couponQuote} from '@/lib/marketplace';
import {ApiError} from '@/lib/transaction';
import {failure} from '@/lib/http';
export async function POST(req:Request){try{sameOrigin(req);const b=await req.json();if(typeof b.code!=='string'||b.code.length>40||!Array.isArray(b.items)||b.items.length>50||b.items.some((i:any)=>typeof i.productId!=='string'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>10)||new Set(b.items.map((i:any)=>i.productId)).size!==b.items.length)throw new ApiError(400,'Invalid coupon request');const ps=await db.product.findMany({where:{id:{in:b.items.map((i:any)=>i.productId)},active:true}});if(ps.length!==b.items.length)throw new ApiError(400,'Some products are unavailable');const subtotal=b.items.reduce((sum:number,i:any)=>sum+ps.find(p=>p.id===i.productId)!.priceCents*i.quantity,0);return NextResponse.json({...await couponQuote(db,b.code.trim(),subtotal),subtotalCents:subtotal});}catch(e){return failure(e);}}
