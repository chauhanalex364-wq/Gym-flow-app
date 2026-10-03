import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { FAQ_BUNDLE } from "./kb.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || readNamedKey("SUPABASE_PUBLISHABLE_KEYS", "default");
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || readNamedKey("SUPABASE_SECRET_KEYS", "default");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-6-luna";

function readNamedKey(envName:string,name:string){
  const raw=Deno.env.get(envName);
  if(!raw) return "";
  try { const parsed=JSON.parse(raw); return parsed?.[name]||""; } catch { return raw; }
}
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}})}
function norm(v:string){return String(v||"").toLowerCase().replace(/[\u0000-\u001f]/g," ").replace(/[^a-z0-9\u0900-\u097f@.₹ ]+/g," ").replace(/\s+/g," ").trim()}
function detectLanguage(q:string, requested?:string){
  if(requested && ["english","hindi","hinglish"].includes(requested)) return requested;
  if(/[\u0900-\u097f]/.test(q)) return "hindi";
  const h=(q.match(/\b(ka|ki|ke|hai|haan|nahi|batao|bata|kar|karo|do|mujhe|mera|meri|aaj|kal|kitna|kitne|se|me|mein|ko|par|kyu|kaise)\b/gi)||[]).length;
  return h>=2 ? "hinglish" : "english";
}
function inScope(q:string){
  const n=norm(q);
  if(/^(hi|hello|hey|namaste|help|thanks|thank you|thx)\b/.test(n)) return true;
  const words=["gym","gymflow","member","attendance","present","check in","dues","due","payment","upi","invoice","plan","workout","diet","trainer","revenue","owner","dashboard","software","app","website","domain","notification","login","access code","qr","face","profile","expiry","renew","report","analytics","settings","theme","branding","pwa","install","support","ai assistant","chatbot"];
  return words.some(w=>n.includes(w));
}
function memberMatch(members:any[],q:string){
  const n=norm(q);
  const exact=members.filter(m=>{const name=norm(m.payload?.name||"");return name && (n.includes(name)||n.includes(name.split(" ")[0]));});
  if(exact.length===1) return exact[0];
  // Score by all name tokens for slightly fuzzy queries.
  let best:any=null,bestScore=0;
  for(const m of members){const name=norm(m.payload?.name||"");if(!name)continue;let score=0;for(const t of name.split(" ")) if(t.length>2&&n.includes(t))score++;if(score>bestScore){best=m;bestScore=score}}
  return bestScore>0?best:null;
}
function money(n:number){return `₹${Number(n||0).toLocaleString("en-IN")}`}
function todayIST(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function timeIST(){return new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date())}
function uid(prefix:string){return `${prefix}-${crypto.randomUUID().replaceAll("-","").slice(0,18).toUpperCase()}`}
function parseAmount(q:string){const m=q.match(/(?:₹|rs\.?|rupees?\s*)\s*([0-9][0-9,]*(?:\.\d+)?)/i);return m?Number(m[1].replaceAll(",","")):null}
function parseMethod(q:string){const n=norm(q);if(n.includes("cash"))return "Cash";if(n.includes("bank"))return "Bank Transfer";if(n.includes("card"))return "Card";return "UPI"}
function intentFor(q:string){
  const n=norm(q);
  if(/invoice|bill|receipt/.test(n)&&/(create|make|bana|generate|issue|prepare)/.test(n)) return "create_invoice";
  if(/payment|paid|collect|receive/.test(n)&&/(record|add|mark|save|bata|show|kitna|amount)/.test(n) && !/invoice/.test(n)) return "payment_or_payments";
  if(/mark.*(present|attendance)|attendance.*(mark|present)|present.*mark|hazri/.test(n)) return "mark_attendance";
  if(/dues?|pending amount|outstanding|bakaya/.test(n) && /attendance|check.?in|hazri/.test(n)) return "member_snapshot";
  if(/payment history|payments?\s+(history|details|list)|kitna payment/.test(n)) return "member_payments";
  if(/dues?|pending amount|outstanding|bakaya/.test(n)) return "member_due";
  if(/attendance|check.?in|hazri/.test(n)) return "member_attendance";
  if(/revenue|income|collection|collected|earn/.test(n)) return "revenue";
  if(/expir|renew|renewal/.test(n)) return "expiry";
  if(/block|unblock/.test(n)) return "member_status";
  if(/member|client|customer/.test(n)) return "member_detail";
  if(/open|go to|show.*page|kholo|page/.test(n)) return "navigate";
  return "knowledge";
}
function sectionFor(q:string){
  const n=norm(q); if(/payment|upi|revenue|collection/.test(n)) return "payments"; if(/invoice|bill|receipt/.test(n)) return "invoices"; if(/attendance|check in|hazri|present/.test(n)) return "attendance"; if(/plan|membership/.test(n)) return "plans"; if(/workout|diet/.test(n)) return "workouts"; if(/setting|theme|upi id/.test(n)) return "settings"; if(/member|client/.test(n)) return "members"; return "overview";
}
function dueAmount(member:any, plans:any[], payments:any[]){
  const explicit=[member.payload?.dueAmount,member.payload?.amountDue,member.payload?.due,member.payload?.pending].map(Number).find(x=>Number.isFinite(x));
  if(explicit!==undefined) return Math.max(0,explicit||0);
  const p=plans.find(x=>norm(x.payload?.name||"")===norm(member.payload?.plan||""));
  const price=Number(p?.payload?.price||0);
  const memberPayments=payments.filter(x=>x.payload?.memberId===member.payload?.id);
  if(price>0 && memberPayments.length===0) return price;
  return 0;
}
async function logAudit(admin:any,args:{gym_id:string,owner_user_id:string,language:string,question:string,intent:string,action_type?:string,success?:boolean}){
  await admin.from("gymflow_ai_logs").insert(args).catch(()=>{});
}
function localizedAnswer(lang:string,en:string,hi:string){return lang==="hindi"?hi:en}
function pickFaq(q:string,lang:string){
  const n=norm(q); const words=n.split(" ").filter(x=>x.length>2); let best:any=null,bestScore=0;
  for(const item of FAQ_BUNDLE){const t=norm(item.q);let score=0;for(const w of words) if(t.includes(w))score++;if(score>bestScore){best=item;bestScore=score}}
  if(bestScore<2) return null;
  return lang==="hindi"?best.a_hi:lang==="hinglish"?best.a_hinglish:best.a_en;
}
async function callModel(question:string,lang:string,context:any){
  if(!OPENAI_API_KEY) return null;
  const languageName=lang==="hindi"?"Hindi":lang==="hinglish"?"Hinglish (Roman Hindi mixed with simple English)":"English";
  const system=`You are GymFlow Assistant. Answer ONLY about GymFlow software and gym-management operations. Never answer unrelated general topics. You can use the provided live gym context. Never invent member, payment, attendance or invoice values. Be concise, polished and easy to scan. Use the requested language: ${languageName}. Do not use Markdown heading hashes, dollar-hash markers, or decorative punctuation. Prefer short sections, labels and bullets. When live data is unavailable, say so.`;
  const body={model:OPENAI_MODEL,input:[{role:"system",content:system},{role:"user",content:`Question: ${question}\nLive gym context:\n${JSON.stringify(context)}`}],max_output_tokens:700};
  const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify(body)});
  if(!res.ok) return null;
  const data=await res.json(); return data.output_text || data.output?.flatMap((x:any)=>x.content||[]).map((c:any)=>c.text||"").join(" ") || null;
}

Deno.serve(async req=>{
  if(req.method!=="POST") return json({error:"POST only"},405);
  try{
    const auth=req.headers.get("authorization")||"";
    if(!auth) return json({error:"Authentication required."},401);
    const userClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if(userError||!user) return json({error:"Authentication required."},401);
    const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY);
    const {data:profile,error:profileError}=await admin.from("gymflow_profiles").select("id,role,gym_id,name,phone").eq("id",user.id).maybeSingle();
    if(profileError||!profile||profile.role!=="owner") return json({error:"Owner access is required for this assistant."},403);
    const body=await req.json(); const question=String(body?.question||"").trim(); if(!question) return json({error:"Ask a GymFlow or gym-management question."},400); if(question.length>900) return json({error:"Please keep the message under 900 characters."},400);
    const language=detectLanguage(question,body?.language); const intent=intentFor(question); const gymId=profile.gym_id;
    const {data:rows,error:rowsError}=await admin.from("gymflow_records").select("id,record_type,payload").eq("gym_id",gymId).in("record_type",["gyms","members","plans","payments","invoices","attendance","workouts","diets","orders"]);
    if(rowsError) throw rowsError;
    const members=(rows||[]).filter(r=>r.record_type==="members"); const plans=(rows||[]).filter(r=>r.record_type==="plans"); const payments=(rows||[]).filter(r=>r.record_type==="payments"); const invoices=(rows||[]).filter(r=>r.record_type==="invoices"); const att=(rows||[]).filter(r=>r.record_type==="attendance");
    const member=memberMatch(members,question);
    let action:null|any=null; let answer=null; let navigate=sectionFor(question);
    const baseContext={gym:(rows||[]).find(r=>r.record_type==="gyms")?.payload||{},stats:{members:members.length,todayAttendance:att.filter(x=>x.payload?.date===todayIST()).length,revenue:payments.reduce((s,x)=>s+Number(x.payload?.amount||0),0),invoices:invoices.length},member:member?.payload||null};

    if(!inScope(question)){
      answer=language==="hindi"?"Main sirf GymFlow aur gym-management questions me help kar sakta hoon.":language==="hinglish"?"Main sirf GymFlow aur gym-management questions me help kar sakta hoon.\nI can help with members, attendance, payments, invoices, plans and gym operations.":"I can help only with GymFlow and gym-management questions such as members, attendance, payments, invoices, plans and gym operations.";
    } else if(intent==="member_snapshot" && member){
      const p=member.payload||{}; const d=dueAmount(member,plans,payments); const logs=att.filter(x=>x.payload?.memberId===p.id).sort((a,b)=>String(b.payload?.date||"").localeCompare(String(a.payload?.date||""))); const present=logs.some(x=>x.payload?.date===todayIST());
      answer=language==="hindi"?`Member\n${p.name}\n\nDues: ${d>0?money(d):'Clear'}\nStatus: ${p.status||'Active'}\nAaj attendance: ${present?'Present':'Not marked'}\nTotal check-ins: ${Number(p.attendance||logs.length)}\nExpiry: ${p.expiry||'—'}`:`Member\n${p.name}\n\nDues: ${d>0?money(d):'Clear'}\nStatus: ${p.status||'Active'}\nAaj attendance: ${present?'Present':'Not marked'}\nTotal check-ins: ${Number(p.attendance||logs.length)}\nExpiry: ${p.expiry||'—'}`;
    } else if(intent==="member_due" && member){
      const d=dueAmount(member,plans,payments); const p=member.payload||{}; const expiry=p.expiry||"—"; const status=p.status||"Active";
      answer=localizedAnswer(language,`Member\n${p.name}\n\nDue status: ${status==='Due'||d>0?'Pending':'Clear'}\nDue amount: ${money(d)}\nPlan: ${p.plan||'—'}\nExpiry: ${expiry}`,`Member\n${p.name}\n\nDue status: ${status==='Due'||d>0?'Pending':'Clear'}\nDue amount: ${money(d)}\nPlan: ${p.plan||'—'}\nExpiry: ${expiry}`);
    } else if(intent==="member_attendance" && member){
      const p=member.payload||{}; const logs=att.filter(x=>x.payload?.memberId===p.id).sort((a,b)=>String(b.payload?.date||"").localeCompare(String(a.payload?.date||""))); const today=logs.some(x=>x.payload?.date===todayIST());
      answer=localizedAnswer(language,`Member\n${p.name}\n\nToday: ${today?'Present':'Not marked'}\nTotal check-ins: ${Number(p.attendance||0)}\nRecent: ${logs.slice(0,5).map(x=>x.payload?.date).join(", ")||'No records'}`,`Member\n${p.name}\n\nAaj: ${today?'Present':'Not marked'}\nTotal check-ins: ${Number(p.attendance||0)}\nRecent: ${logs.slice(0,5).map(x=>x.payload?.date).join(", ")||'No records'}`);
    } else if(intent==="member_payments" && member){
      const p=member.payload||{}; const list=payments.filter(x=>x.payload?.memberId===p.id).sort((a,b)=>String(b.payload?.date||"").localeCompare(String(a.payload?.date||""))).slice(0,8); const total=list.reduce((s,x)=>s+Number(x.payload?.amount||0),0); answer=`${p.name} ke recent payments\nTotal listed: ${money(total)}\n${list.map(x=>`${x.payload?.date||'—'} · ${money(x.payload?.amount)} · ${x.payload?.method||'—'}`).join("\n")||'No payments found'}`; navigate="payments";
    } else if(intent==="member_detail" && member){
      const p=member.payload||{}; const d=dueAmount(member,plans,payments); const logs=att.filter(x=>x.payload?.memberId===p.id); answer=localizedAnswer(language,`${p.name}\nPlan: ${p.plan||'—'}\nExpiry: ${p.expiry||'—'}\nStatus: ${p.status||'Active'}\nDue: ${money(d)}\nAttendance: ${Number(p.attendance||logs.length)}`,`${p.name}\nPlan: ${p.plan||'—'}\nExpiry: ${p.expiry||'—'}\nStatus: ${p.status||'Active'}\nDue: ${money(d)}\nAttendance: ${Number(p.attendance||logs.length)}`);
    } else if(intent==="create_invoice"){
      if(!member){answer=language==="hindi"?"Invoice banane ke liye member ka naam bhi batayein.":"Tell me the member name so I can create the invoice.";}
      else{
        const p=member.payload||{}; const plan=plans.find(x=>norm(x.payload?.name||"")===norm(p.plan||"")); const amount=parseAmount(question) ?? Number(plan?.payload?.price||0);
        if(!(amount>0)) answer=language==="hindi"?"Invoice amount clear nahi hai. Amount batayein.":"I need the invoice amount. Please include an amount or use a member with a priced plan.";
        else{
          const inv={id:uid("INV"),gymId,memberId:p.id,memberName:p.name,amount,method:parseMethod(question),date:todayIST(),note:"Created by GymFlow AI Assistant"};
          const {error}=await admin.from("gymflow_records").insert({id:inv.id,gym_id:gymId,record_type:"invoices",payload:inv}); if(error) throw error;
          action={type:"create_invoice",record:inv}; navigate="invoices"; answer=language==="hindi"?`Invoice ready\nMember: ${p.name}\nAmount: ${money(amount)}\nMethod: ${inv.method}\nInvoice ID: ${inv.id}`:language==="hinglish"?`Invoice ready\nMember: ${p.name}\nAmount: ${money(amount)}\nMethod: ${inv.method}\nInvoice ID: ${inv.id}`:`Invoice ready\nMember: ${p.name}\nAmount: ${money(amount)}\nMethod: ${inv.method}\nInvoice ID: ${inv.id}`;
        }
      }
    } else if(intent==="mark_attendance"){
      if(!member){answer=language==="hindi"?"Attendance mark karne ke liye member ka naam batayein.":"Tell me the member name so I can mark attendance.";}
      else{
        const p=member.payload||{}; const exists=att.some(x=>x.payload?.memberId===p.id && x.payload?.date===todayIST());
        if(p.status==="Blocked" || (p.expiry && String(p.expiry)<todayIST())) answer=language==="hindi"?"Ye member attendance ke liye active nahi hai.":"This member is not eligible for attendance because the membership is blocked or expired.";
        else if(exists) answer=language==="hindi"?`${p.name} ki aaj ki attendance pehle se marked hai.`:`${p.name} is already marked present today.`;
        else{
          const row={id:uid("ATT"),gymId,memberId:p.id,memberName:p.name,memberCode:p.code,date:todayIST(),time:timeIST(),source:"ai-assistant"};
          const {error}=await admin.from("gymflow_records").insert({id:row.id,gym_id:gymId,record_type:"attendance",payload:row}); if(error) throw error;
          const updated={...p,attendance:Number(p.attendance||0)+1}; const {error:me}=await admin.from("gymflow_records").update({payload:updated,updated_at:new Date().toISOString()}).eq("id",p.id).eq("gym_id",gymId).eq("record_type","members"); if(me) throw me;
          action={type:"mark_attendance",record:row,member:updated}; navigate="attendance"; answer=language==="hindi"?`${p.name} ki aaj ki attendance mark ho gayi.`:`${p.name} is marked present for today.`;
        }
      }
    } else if(intent==="payment_or_payments" && member && /(record|mark|save|paid|receive|collect|jama|payment add)/.test(norm(question))){
      const amount=parseAmount(question); if(!(amount>0)) answer=language==="hindi"?"Payment record karne ke liye amount batayein.":"Please include the payment amount so I can record it.";
      else{
        const p=member.payload||{}; const pay={id:uid("PAY"),gymId,memberId:p.id,memberName:p.name,amount,method:parseMethod(question),date:todayIST()}; const {error}=await admin.from("gymflow_records").insert({id:pay.id,gym_id:gymId,record_type:"payments",payload:pay}); if(error)throw error; const {error:me}=await admin.from("gymflow_records").update({payload:{...p,status:"Active",dueAmount:0},updated_at:new Date().toISOString()}).eq("id",p.id).eq("gym_id",gymId).eq("record_type","members"); if(me)throw me; action={type:"record_payment",record:pay}; navigate="payments"; answer=`Payment recorded\n${p.name}\n${money(amount)} · ${pay.method}`;
      }
    } else if(intent==="member_status" && member){
      const n=norm(question); const blocked=n.includes("block")&&!n.includes("unblock"); const unblocked=n.includes("unblock"); const p=member.payload||{}; const nextStatus=blocked?"Blocked":unblocked?"Active":p.status; if(nextStatus!==p.status){const updated={...p,status:nextStatus};const {error}=await admin.from("gymflow_records").update({payload:updated,updated_at:new Date().toISOString()}).eq("id",p.id).eq("gym_id",gymId).eq("record_type","members");if(error)throw error;action={type:"update_member_status",member:updated};answer=`${p.name}: status updated to ${nextStatus}.`;navigate="members";}else answer=`${p.name} is currently ${p.status||"Active"}.`;
    } else if(intent==="revenue"){
      const revenue=payments.reduce((s,x)=>s+Number(x.payload?.amount||0),0); answer=language==="hindi"?`Recorded revenue: ${money(revenue)}\nPayments: ${payments.length}`:`Recorded revenue: ${money(revenue)}\nPayments: ${payments.length}`; navigate="payments";
    } else if(intent==="expiry"){
      const near=members.map(x=>x.payload).filter(p=>p?.expiry).map(p=>({p,diff:Math.ceil((new Date(p.expiry+"T23:59:59+05:30").getTime()-Date.now())/86400000)})).filter(x=>x.diff<=7).sort((a,b)=>a.diff-b.diff).slice(0,10); answer=near.length?near.map(x=>`${x.p.name} · ${x.diff<0?'Expired':x.diff+' days'} · ${x.p.expiry}`).join("\n"):"No members are expiring within 7 days."; navigate="members";
    } else if(intent==="navigate"){
      navigate=sectionFor(question); answer=language==="hindi"?`The ${navigate} section is ready.`:`Opening the ${navigate} section.`;
    }

    if(!answer){
      const faq=pickFaq(question,language); if(faq) answer=faq;
      if(!answer) answer=await callModel(question,language,baseContext);
      if(!answer) answer=language==="hindi"?"Main GymFlow aur gym-management help ke liye ready hoon. Member, attendance, dues, payment ya invoice ke baare me puch sakte hain.":language==="hinglish"?"Main GymFlow aur gym-management help ke liye ready hoon.\nMember, attendance, dues, payment ya invoice ke baare me pucho.":"I’m ready for GymFlow and gym-management help. Ask about members, attendance, dues, payments or invoices.";
    }
    await logAudit(admin,{gym_id:gymId,owner_user_id:user.id,language,question,intent,action_type:action?.type,success:true});
    return json({ok:true,answer,language,intent,action,navigate,stats:baseContext.stats});
  }catch(e){
    return json({ok:false,error:e?.message||"Assistant error."},500);
  }
});
