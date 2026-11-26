import {redirect} from 'next/navigation';import {currentActor,requireRole,Actor} from './auth';import {commerce} from './backend';
export async function adminRead(target:string,roles:Actor['role'][]=['ops','finance']){if(!await currentActor())redirect('/login');const actor=await requireRole(roles);await commerce('/api/views/audit',{target});return actor;}
