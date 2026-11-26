import {cookies} from 'next/headers';
import {ApiError} from './transaction';
export async function customer(){
 const token=(await cookies()).get('payops_customer')?.value;
 if(!token)return null;
 const r=await fetch(`${process.env.IDENTITY_URL}/v1/session`,{headers:{authorization:`Bearer ${process.env.IDENTITY_SERVICE_TOKEN}`,'x-session-token':token},cache:'no-store',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw new ApiError(503,'Identity service unavailable');
 return (await r.json()).customer as {id:string;email:string;name:string}|null;
}
export async function requireCustomer(){const c=await customer();if(!c)throw new ApiError(401,'Sign in to continue');return c;}
