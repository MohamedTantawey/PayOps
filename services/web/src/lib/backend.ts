import {headers} from 'next/headers';
export async function commerce(path:string,body?:unknown){
 const h=await headers();
 const r=await fetch(`${process.env.COMMERCE_URL}${path}`,{method:body?'POST':'GET',headers:{'x-service-token':process.env.COMMERCE_SERVICE_TOKEN||'','content-type':'application/json',cookie:h.get('cookie')||'',authorization:h.get('authorization')||''},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(`Commerce service unavailable (${r.status})`);
 return revive(await r.json());
}
function revive(v:any):any{if(Array.isArray(v))return v.map(revive);if(v&&typeof v==='object'){for(const k of Object.keys(v))v[k]=/^(createdAt|updatedAt|expiresAt|nextAttemptAt|receivedAt|deliveredAt)$/.test(k)&&typeof v[k]==='string'?new Date(v[k]):revive(v[k]);}return v;}
