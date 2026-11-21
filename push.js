/* Δρομολόγια: browser Web Push. No service keys or private VAPID keys are shipped. */
(() => {
 "use strict";
 const API="https://oikcdjnxkmgrpyedxera.supabase.co/functions/v1/douleia-push";
 const STORAGE="douleia.push.device.v1";
 const $=id=>document.getElementById(id);
 const getCredentials=()=>{try{const v=JSON.parse(localStorage.getItem(STORAGE)||"null");return v?.deviceId&&v?.token?v:null;}catch{return null;}};
 const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
 const decode=value=>Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
 function ensureCredentials(){
  const found=getCredentials();if(found)return found;
  const v={deviceId:crypto.randomUUID(),token:encode(crypto.getRandomValues(new Uint8Array(32)))};
  localStorage.setItem(STORAGE,JSON.stringify(v));return v;
 }
 const supported=()=>window.isSecureContext&&"Notification" in window&&"PushManager" in window&&"serviceWorker" in navigator;
 let busy=false,enabled=false,keyPromise=null,lastTestAt=0,cooldownTimer=null;
 function markTestSent(){
  lastTestAt=Date.now();
  if(cooldownTimer)clearInterval(cooldownTimer);
  cooldownTimer=setInterval(()=>{
   if(Date.now()-lastTestAt>=45000){clearInterval(cooldownTimer);cooldownTimer=null;}
   state($("pushStatus")?.textContent||"");
  },1000);
 }
 function state(note=""){
  const status=$("pushStatus"),enable=$("pushEnable"),test=$("pushTest"),disable=$("pushDisable");
  if(!status)return;
  const permitted=supported()&&Notification.permission==="granted";
  const embedded=window.top!==window.self;
  if($("pushStandalone"))$("pushStandalone").hidden=!embedded;
  status.textContent=note || (embedded&&!enabled?"Άνοιξε τα Δρομολόγια ξεχωριστά για να επιτρέψεις τις ειδοποιήσεις.":!supported()?"Η συσκευή δεν υποστηρίζει Web Push.":enabled?"Οι ειδοποιήσεις είναι ενεργές.":Notification.permission==="denied"?"Οι ειδοποιήσεις έχουν αποκλειστεί στον browser.":"Ειδοποιήσεις καθυστέρησης αναχώρησης και άφιξης.");
  enable.hidden=enabled||embedded;test.hidden=!enabled;disable.hidden=!enabled;
  enable.disabled=busy;
  enable.title=!supported()?"Πάτησε για οδηγίες υποστήριξης ειδοποιήσεων":"";
  const seconds=Math.max(0,Math.ceil((lastTestAt+45000-Date.now())/1000));
  test.textContent=seconds?"Δοκιμή σε "+seconds+"″":"Δοκιμή push";
  test.disabled=busy||!permitted||seconds>0;disable.disabled=busy;
 }
 async function call(action,data={}){
  const response=await fetch(API,{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,...data})});
  let body={};try{body=await response.json();}catch{}
  if(!response.ok||!body.ok)throw new Error(body.error||"Δεν υπάρχει σύνδεση με το Supabase.");
  return body;
 }
 async function getKey(){
  if(!keyPromise)keyPromise=fetch(API,{cache:"no-store"}).then(async r=>{
   if(!r.ok)throw new Error("Η υπηρεσία Push δεν απαντά.");
   const data=await r.json();if(!data.ok||!data.vapidPublicKey)throw new Error("Τα κλειδιά Push δεν έχουν ρυθμιστεί.");
   return data.vapidPublicKey;
  }).catch(e=>{keyPromise=null;throw e});
  return keyPromise;
 }
 async function registration(){
  await navigator.serviceWorker.register("./sw.js",{scope:"./"});
  return navigator.serviceWorker.ready;
 }
 async function connect(allowSubscribe){
  const reg=await registration();
  let sub=await reg.pushManager.getSubscription();
  if(!sub&&allowSubscribe)sub=await reg.pushManager.subscribe({
    userVisibleOnly:true,applicationServerKey:decode(await getKey())
  });
  if(!sub)return false;
  await call("register",{...ensureCredentials(),subscription:JSON.parse(JSON.stringify(sub))});
  enabled=true;state();return true;
 }
 async function enable(){
  if(busy)return;busy=true;state("Ενεργοποίηση ειδοποιήσεων…");
  try{
   if(!supported())throw new Error("Αυτό το περιβάλλον δεν υποστηρίζει Web Push. Άνοιξε τα Δρομολόγια απευθείας στον Chrome και όχι μέσα σε άλλη εφαρμογή.");
   if(Notification.permission==="denied")throw new Error("Οι ειδοποιήσεις είναι αποκλεισμένες. Άνοιξε τις ρυθμίσεις του Chrome → Δικαιώματα ιστοτόπου → Ειδοποιήσεις και επέτρεψέ τες.");
   if(window.top!==window.self)throw new Error("Άνοιξε τα Δρομολόγια σε ξεχωριστό παράθυρο για να δώσεις άδεια.");
   const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
   if(permission!=="granted")throw new Error("Δεν δόθηκε άδεια ειδοποιήσεων.");
   await getKey();
   state("Σύνδεση της συσκευής με την υπηρεσία Push…");
   await connect(true);
   await call("test",getCredentials());
   markTestSent();
   state("Ενεργές ειδοποιήσεις — στάλθηκε δοκιμαστικό push.");
  }catch(e){state((e?.name==="AbortError"?"Η εγγραφή Push διακόπηκε. Έλεγξε τη σύνδεση και ξαναπροσπάθησε.":e?.message)||"Αδυναμία ενεργοποίησης.");}
  finally{busy=false;state($("pushStatus")?.textContent||"");}
 }
 async function test(){
  if(busy)return;busy=true;state("Αποστολή δοκιμαστικής ειδοποίησης…");
  try{await call("test",getCredentials());markTestSent();state("Το δοκιμαστικό push στάλθηκε στη συσκευή.");}
  catch(e){state(e.message||"Αποτυχία δοκιμής.");}
  finally{busy=false;state($("pushStatus")?.textContent||"");}
 }
 async function disable(){
  if(busy)return;busy=true;state("Απενεργοποίηση…");
  try{
   const creds=getCredentials();if(creds)await call("disable",creds);
   enabled=false;
   const reg=await registration(),sub=await reg.pushManager.getSubscription();
   if(sub)await sub.unsubscribe();
   state("Οι ειδοποιήσεις απενεργοποιήθηκαν σε αυτή τη συσκευή.");
  }catch(e){state(e.message||"Αδυναμία απενεργοποίησης.");}
  finally{busy=false;state($("pushStatus")?.textContent||"");}
 }
 async function init(){
  $("pushEnable")?.addEventListener("click",enable);
  $("pushTest")?.addEventListener("click",test);
  $("pushDisable")?.addEventListener("click",disable);
  state();
  if(!supported()||Notification.permission!=="granted"||!getCredentials())return;
  try{await getKey();await connect(false);}
  catch(e){console.warn("Douleia Push reconnect:",e);state("Δεν έγινε σύνδεση Push. Πάτησε Ενεργοποίηση.");}
 }
 window.DouleiaPushDiagnostics={supported,permission:()=>("Notification" in window?Notification.permission:"unsupported"),registered:()=>enabled};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
 else init();
})();