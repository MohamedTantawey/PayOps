import {NextResponse} from 'next/server';
import {sameOrigin} from '@/lib/auth';
import {requireCustomer} from '@/lib/customer';
import {requestKey} from '@/lib/payments';
import {marketCheckout,parseAddress} from '@/lib/marketplace';
import {ApiError} from '@/lib/transaction';
import {failure} from '@/lib/http';
export async function POST(req:Request){try{sameOrigin(req);const c=await requireCustomer();const b=await req.json();if(!Array.isArray(b.items)||!b.items.length||b.items.length>50||b.items.some((i:any)=>typeof i.productId!=='string'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>10)||new Set(b.items.map((i:any)=>i.productId)).size!==b.items.length)throw new ApiError(400,'Use 1–50 distinct products with quantities from 1–10');const code=typeof b.coupon==='string'?b.coupon.trim().toUpperCase():'';if(code.length>40)throw new ApiError(400,'Invalid coupon');return NextResponse.json(await marketCheckout(requestKey(req),c.id,b.items,code,parseAddress(b.address),c.email));}catch(e){return failure(e);}}
