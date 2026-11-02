import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!;
 const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth=req.headers.get('Authorization')||'';
 if(!auth.startsWith('Bearer '))return response({error:'Unauthorized'},401);
 const requester=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 const {data:{user},error:userError}=await requester.auth.getUser();
 if(userError||!user)return response({error:'Unauthorized'},401);
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:staff,error:staffError}=await admin.from('warehouse_staff').select('role,status,permissions').eq('user_id',user.id).maybeSingle();
 if(staffError||!staff||staff.status!=='active'||!(staff.role==='admin'||staff.permissions?.personnel_manage===true))return response({error:'Forbidden'},403);
 let body:any;
 try{body=await req.json()}catch{return response({error:'Invalid JSON'},400)}
 const {action,email,full_name,position,role,status,permissions,password}=body;
 const mail=String(email||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)||!String(full_name||'').trim()||!['admin','manager','warehouse','viewer'].includes(role)||!['active','inactive'].includes(status)||!permissions||typeof permissions!=='object'||Array.isArray(permissions)||Object.values(permissions).some(v=>typeof v!=='boolean'))return response({error:'Invalid staff details'},400);
 if(password!==undefined&&(typeof password!=='string'||password.length<8))return response({error:'Password must be at least 8 characters'},400);
 if(action==='create'){
  if(!password)return response({error:'Password is required'},400);
  const {data:created,error:createError}=await admin.auth.admin.createUser({email:mail,password,email_confirm:true,user_metadata:{full_name:String(full_name).trim()}});
  if(createError||!created.user)return response({error:createError?.message||'Unable to create account'},400);
  const {error:profileError}=await admin.from('warehouse_staff').insert({user_id:created.user.id,email:mail,full_name:String(full_name).trim(),position:String(position||''),role,status,permissions});
  if(profileError){await admin.auth.admin.deleteUser(created.user.id);return response({error:profileError.message},400)}
  return response({ok:true,user_id:created.user.id});
 }
 if(action==='update'){
  const {data:target,error:lookupError}=await admin.from('warehouse_staff').select('user_id,role').eq('email',mail).maybeSingle();
  if(lookupError||!target)return response({error:'Staff member not found'},404);
  if(target.user_id===user.id&&(status!=='active'||role!=='admin'))return response({error:'Cannot revoke your own administrator access'},400);
  if(password){const {error:pwError}=await admin.auth.admin.updateUserById(target.user_id,{password});if(pwError)return response({error:pwError.message},400)}
  const {error:updateError}=await admin.from('warehouse_staff').update({full_name:String(full_name).trim(),position:String(position||''),role,status,permissions,updated_at:new Date().toISOString()}).eq('user_id',target.user_id);
  if(updateError)return response({error:updateError.message},400);
  return response({ok:true,user_id:target.user_id});
 }
 return response({error:'Invalid action'},400);
});
