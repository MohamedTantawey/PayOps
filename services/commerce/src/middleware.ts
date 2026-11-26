import {NextRequest,NextResponse} from 'next/server';
export function middleware(req:NextRequest){const key=process.env.COMMERCE_SERVICE_TOKEN;if(!key||key.length<32||req.headers.get('x-service-token')!==key)return NextResponse.json({error:'Service authentication required'},{status:401});return NextResponse.next();}
export const config={matcher:['/api/:path*']};
