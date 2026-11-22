import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const URL_BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if(!URL_BASE || !SERVICE_KEY) throw new Error("Missing Supabase service configuration");
const db=createClient(URL_BASE,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGIN="https://seemsfunny21.github.io";
const HEADERS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET, POST, OPTIONS",
 "Access-Control-Allow-Headers":"content-type","Cache-Control":"no-store","Vary":"Origin"};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64=/^[A-Za-z0-9_-]+$/;
const reply=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...HEADERS,"Content-Type":"application/json; charset=utf-8"}});
const error=(message:string,status=400)=>reply({ok:false,error:message},status);

async function secret(name:string):Promise<Record<string,any>|null>{
 const {data,error}=await db.from("douleia_push_secrets").select("value").eq("name",name).maybeSingle();
 if(error)throw error;return data?.value||null;
}
let vapidPromise:Promise<Record<string,any>>|null=null;
function vapid(){
 if(!vapidPromise)vapidPromise=(async()=>{
  let item=await secret("vapid");
  if(!item){
   const keys=await webpush.generateVapidKeys({extractable:true});
   const exported=await webpush.exportVapidKeys(keys);
   const publicKey=await webpush.exportApplicationServerKey(keys);
   const {error}=await db.from("douleia_push_secrets").upsert(
     {name:"vapid",value:{exported,publicKey}},{onConflict:"name",ignoreDuplicates:true});
   if(error)throw error;
   item=await secret("vapid");
  }
  if(!item?.publicKey || !item?.exported)throw new Error("VAPID not available");
  return item;
 })().catch(e=>{vapidPromise=null;throw e});
 return vapidPromise;
}
let serverPromise:Promise<webpush.ApplicationServer>|null=null;
function server(){
 if(!serverPromise)serverPromise=(async()=>{
  const keys=await vapid();
  const imported=await webpush.importVapidKeys(keys.exported as webpush.ExportedVapidKeys);
  return webpush.ApplicationServer.new({contactInformation:"https://seemsfunny21.github.io/douleia/",vapidKeys:imported});
 })().catch(e=>{serverPromise=null;throw e});
 return serverPromise;
}
type Device={endpoint:string,subscription:any,device_id:string,token_hash:string,enabled:boolean,last_test_at:string|null};
async function sha256(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))))
 .map(x=>x.toString(16).padStart(2,"0")).join("");}
function credentials(id:unknown,token:unknown){
 return typeof id==="string"&&UUID.test(id)&&typeof token==="string"&&token.length>=35&&token.length<=200&&BASE64.test(token);
}
function validSubscription(s:any){
 if(!s || typeof s.endpoint!=="string" || s.endpoint.length>1600)return false;
 let url:URL;
 try{url=new URL(s.endpoint);}catch{return false;}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=="https:" || url.username || url.password ||
    !(host==="fcm.googleapis.com"||host.endsWith(".push.apple.com")||host.endsWith(".push.services.mozilla.com")))return false;
 return !!s.keys && typeof s.keys.p256dh==="string" && BASE64.test(s.keys.p256dh) &&
  s.keys.p256dh.length>=60 && s.keys.p256dh.length<=150 &&
  typeof s.keys.auth==="string" && BASE64.test(s.keys.auth) &&
  s.keys.auth.length>=10 && s.keys.auth.length<=100;
}
async function verified(id:any,token:any):Promise<Device|null>{
 if(!credentials(id,token))return null;
 const {data,error}=await db.from("douleia_push_subscriptions").select("*").eq("device_id",id).maybeSingle();
 if(error)throw error;
 return data && data.token_hash===await sha256(token)?data:null;
}
async function send(device:Device,payload:Record<string,unknown>){
 const s=await server();
 await s.subscribe({endpoint:device.endpoint,keys:device.subscription.keys})
  .pushTextMessage(JSON.stringify(payload),{ttl:3600,urgency:webpush.Urgency.High});
}
function status(error:unknown){const e=error as {response?:{status?:number},status?:number};return Number(e?.response?.status||e?.status||0);}
async function dispatchActivity(devices:Device[]){
 // Individual departure/arrival events are queued by a DB trigger.
 // Claim atomically, retry temporary delivery failures, and never notify
 // for a mere correction of an already completed record.
 const {data:events,error}=await db.rpc("douleia_push_claim_activity",{p_limit:20});
 if(error)throw error;
 if(!events?.length)return {events:0,eventDelivered:0,eventFailed:0};
 if(!devices.length)return {events:events.length,eventDelivered:0,eventFailed:0};
 const driverIds=[...new Set(events.map((e:any)=>String(e.driver_id)))];
 const routeCodes=[...new Set(events.map((e:any)=>String(e.route_code)))];
 const [{data:drivers,error:driversError},{data:routes,error:routesError}]=await Promise.all([
   db.from("dromologia_drivers").select("id,name").in("id",driverIds),
   db.from("dromologia_routes").select("code,name").in("code",routeCodes)
 ]);
 if(driversError)throw driversError;
 if(routesError)throw routesError;
 const driverNames=new Map((drivers||[]).map((x:any)=>[String(x.id),String(x.name)]));
 const routeNames=new Map((routes||[]).map((x:any)=>[String(x.code),String(x.name)]));
 let delivered=0,failed=0;
 for(const event of events){
   const driver=driverNames.get(String(event.driver_id))||"Ο οδηγός";
   const route=(routeNames.get(String(event.route_code))||String(event.route_code)).replace(/^Δρομολόγιο /,"");
   const started=event.kind==="started";
   const time=new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",
     hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(event.occurred_at));
   const payload={
     title:started?"🚐 Αναχώρηση οδηγού":"✅ Άφιξη οδηγού",
     body:driver+(started?" αναχώρησε για το δρομολόγιο ":" επέστρεψε από το δρομολόγιο ")+route+" · "+time,
     tag:"douleia-activity-"+String(event.run_id)+"-"+String(event.kind),
     url:"https://seemsfunny21.github.io/douleia/"
   };
   let eventFailed=0;
   for(let i=0;i<devices.length;i+=8){
     await Promise.all(devices.slice(i,i+8).map(async device=>{
       try{await send(device,payload);delivered++;}
       catch(e){
         failed++;eventFailed++;
         console.error("Douleia activity push failed",status(e),String(e).slice(0,250));
         if([404,410].includes(status(e)))
           await db.from("douleia_push_subscriptions").update({enabled:false}).eq("device_id",device.device_id);
       }
     }));
   }
   // Keep transiently failed events available for a retry. Stable notification
   // tag prevents visible duplicates on browsers that received the first send.
   if(!eventFailed){
     const {error:stampError}=await db.from("douleia_push_events")
       .update({sent_at:new Date().toISOString()}).eq("id",event.id);
     if(stampError)throw stampError;
   }
 }
 return {events:events.length,eventDelivered:delivered,eventFailed:failed};
}
async function dispatch(){
 const {data:devices,error:deviceError}=await db.from("douleia_push_subscriptions")
   .select("*").eq("enabled",true).limit(150);
 if(deviceError)throw deviceError;
 const activity=await dispatchActivity(devices||[]);
 const {data:due,error:dueError}=await db.rpc("douleia_push_due");
 if(dueError)throw dueError;
 if(!due?.length)return reply({ok:true,due:0,claimed:0,delivered:0,failed:0,...activity});
 if(!devices?.length)return reply({ok:true,due:due.length,claimed:0,devices:0,...activity});
 let claimed=0,delivered=0,failed=0;
 for(const route of due){
  const {error:claimError}=await db.from("douleia_push_alerts").insert({
   service_date:route.service_date,route_code:route.route_code,kind:route.kind
  });
  if(claimError){if(claimError.code==="23505")continue;throw claimError;}
  claimed++;
  const label=String(route.route_name).replace(/^Δρομολόγιο /,"");
  const payload={title:route.kind==="departure"?"🚐 Καθυστέρηση αναχώρησης":"🚐 Καθυστέρηση άφιξης",
   body:route.kind==="departure"?"Το δρομολόγιο "+label+" δεν αναχώρησε ακόμη.":"Το δρομολόγιο "+label+" δεν έχει φτάσει ακόμη.",
   tag:"douleia-"+route.service_date+"-"+route.route_code+"-"+route.kind,
   url:"https://seemsfunny21.github.io/douleia/"};
  for(let i=0;i<devices.length;i+=8){
   await Promise.all(devices.slice(i,i+8).map(async(device:Device)=>{
    try{await send(device,payload);delivered++;}
    catch(e){failed++;console.error("Douleia push failure",status(e),String(e).slice(0,260));
     if(status(e)===404||status(e)===410)
      await db.from("douleia_push_subscriptions").update({enabled:false}).eq("device_id",device.device_id);
    }
   }));
  }
 }
 return reply({ok:true,due:due.length,claimed,devices:devices.length,delivered,failed,...activity});
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 const origin=req.headers.get("Origin");
 if(origin && origin!==ORIGIN)return error("Origin not allowed",403);
 try{
  if(req.method==="GET")return reply({ok:true,vapidPublicKey:(await vapid()).publicKey});
  if(req.method!=="POST")return error("Method not allowed",405);
  const raw=await req.text();if(raw.length>12000)return error("Request too large",413);
  let data:any;try{data=JSON.parse(raw);}catch{return error("Invalid JSON");}
  if(!data||typeof data!=="object")return error("Invalid request");
  if(data.action==="dispatch"){
   const cron=await secret("cron");
   if(!cron?.token || req.headers.get("X-Douleia-Cron-Secret")!==cron.token)return error("Forbidden",403);
   return dispatch();
  }
  if(!credentials(data.deviceId,data.token))return error("Invalid device credentials",400);
  if(data.action==="register"){
   if(!validSubscription(data.subscription))return error("Invalid subscription");
   const {data:existing,error:lookupError}=await db.from("douleia_push_subscriptions")
     .select("*").eq("device_id",data.deviceId).maybeSingle();
   if(lookupError)throw lookupError;
   if(existing && existing.token_hash!==await sha256(data.token))return error("Device credentials rejected",403);
   const record={device_id:data.deviceId,token_hash:await sha256(data.token),
    endpoint:data.subscription.endpoint,subscription:data.subscription,
    enabled:true,updated_at:new Date().toISOString()};
   if(existing){
    const {error}=await db.from("douleia_push_subscriptions").update(record).eq("device_id",data.deviceId);
    if(error)throw error;
   }else{
    const {count,error:countError}=await db.from("douleia_push_subscriptions")
     .select("*",{count:"exact",head:true}).eq("enabled",true);
    if(countError)throw countError;
    if((count||0)>=150)return error("Device limit reached",429);
    const {error}=await db.from("douleia_push_subscriptions").insert(record);if(error)throw error;
   }
   return reply({ok:true,enabled:true});
  }
  const device=await verified(data.deviceId,data.token);
  if(!device)return error("Device credentials rejected",403);
  if(data.action==="disable"){
   const {error}=await db.from("douleia_push_subscriptions").update({enabled:false,
     updated_at:new Date().toISOString()}).eq("device_id",device.device_id);
   if(error)throw error;
   return reply({ok:true,enabled:false});
  }
  if(data.action==="test"){
   if(!device.enabled)return error("Notifications disabled",403);
   if(device.last_test_at && Date.now()-Date.parse(device.last_test_at)<45000)return error("Περίμενε λίγο πριν από νέα δοκιμή.",429);
   const {error:stampError}=await db.from("douleia_push_subscriptions").update({last_test_at:new Date().toISOString()})
    .eq("device_id",device.device_id);
   if(stampError)throw stampError;
   await send(device,{title:"🚐 Δρομολόγια • Push ενεργό",
    body:"Οι ειδοποιήσεις καθυστέρησης αναχώρησης και άφιξης είναι ενεργές.",
    tag:"douleia-push-test",url:"https://seemsfunny21.github.io/douleia/"});
   return reply({ok:true,sent:true});
  }
  return error("Unknown action",404);
 }catch(e){console.error("Douleia push handler",String(e));return error("Temporary server error",500);}
});