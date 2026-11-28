import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {requireCustomer} from '@/lib/customer';
import {failure} from '@/lib/http';
export async function GET(){try{const c=await requireCustomer();const orders=await db.order.findMany({where:{customerId:c.id},orderBy:{createdAt:'desc'},take:100,select:{id:true,status:true,totalCents:true,subtotalCents:true,discountCents:true,couponCode:true,currency:true,paymentMethod:true,captureMethod:true,routedConnector:true,routingSummary:true,capturedAmountCents:true,stripeSessionId:true,stripePaymentIntent:true,demo:true,createdAt:true,fulfillment:true,fulfillmentNote:true,trackingNumber:true,trackingUrl:true,shippingAddress:true,items:{select:{name:true,quantity:true,unitCents:true}}}});return NextResponse.json({orders},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
