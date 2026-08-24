const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { businessDate, isShiftCurrent } = require("./business-date");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_ID = "c1";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_DB = {
  consultants: [
    { id: "c1", name: "Kalled", startTime: "08:00", dailyGoal: 300, buttonColor: "#111827", backgroundColor: "#f4f6f8", photo: "" },
    { id: "c2", name: "Consultor 2", startTime: "10:00", dailyGoal: 300, buttonColor: "#111827", backgroundColor: "#f4f6f8", photo: "" },
    { id: "c3", name: "Consultor 3", startTime: "12:00", dailyGoal: 300, buttonColor: "#111827", backgroundColor: "#f4f6f8", photo: "" },
    { id: "c4", name: "Consultor 4", startTime: "14:00", dailyGoal: 300, buttonColor: "#111827", backgroundColor: "#f4f6f8", photo: "" },
    { id: "c5", name: "Consultor 5", startTime: "16:00", dailyGoal: 300, buttonColor: "#111827", backgroundColor: "#f4f6f8", photo: "" }
  ], messages: [], activities: [], shifts: [], cancellationPendings: [], crmRecords: []
};

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DB, null, 2));
function db() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  data.consultants = (data.consultants || []).map(c => ({ buttonColor:"#111827", backgroundColor:"#f4f6f8", photo:"", ...c }));
  data.messages = data.messages || [];
  data.activities = data.activities || [];
  data.shifts = data.shifts || [];
  data.cancellationPendings = data.cancellationPendings || [];
  data.crmRecords = data.crmRecords || [];
  return data;
}
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function id(prefix) { return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`; }
function today() { return businessDate(); }
function now() { return new Date().toISOString(); }
function minutes(t) { const [h,m] = String(t || "00:00").split(":").map(Number); return h*60+m; }
function parseBody(req) { return new Promise((resolve,reject)=>{ let body=""; req.on("data",c=>body+=c); req.on("end",()=>{ if(!body)return resolve({}); try{resolve(JSON.parse(body));}catch{reject(new Error("JSON inválido"));} }); }); }
function send(res,status,payload,type="application/json"){res.writeHead(status,{"Content-Type":`${type}; charset=utf-8`,"Cache-Control":"no-store"});res.end(type==="application/json"?JSON.stringify(payload):payload);}
function currentConsultant(data){const list=data.consultants.slice().sort((a,b)=>minutes(a.startTime)-minutes(b.startTime));const n=new Date(),current=n.getHours()*60+n.getMinutes();let selected=list[0]||null;for(const c of list)if(minutes(c.startTime)<=current)selected=c;return selected;}
function activityCounts(data, consultantId, date){const counts={};for(const a of data.activities.filter(a=>a.date===date&&a.consultantId===consultantId))counts[a.type]=(counts[a.type]||0)+1;return counts;}
function stats(data, consultantId, date){const msgs=data.messages.filter(m=>m.date===date&&m.consultantId===consultantId);const acts=activityCounts(data,consultantId,date);return{messages:msgs.length,goal:(data.consultants.find(c=>c.id===consultantId)||{}).dailyGoal||0,activities:acts};}
function openShift(data,consultantId){const consultant=data.consultants.find(c=>c.id===consultantId);return data.shifts.find(s=>s.consultantId===consultantId&&isShiftCurrent(s,consultant?.startTime))||null;}
function belongsToShift(item,shift,timeField){
  if(item.shiftId&&item.shiftId!==shift.id)return false;
  const timestamp=item[timeField];
  if(!timestamp)return item.shiftId===shift.id;
  const value=new Date(timestamp).getTime(),start=new Date(shift.startedAt).getTime(),end=shift.endedAt?new Date(shift.endedAt).getTime():Date.now();
  return value>=start&&value<=end;
}
function shiftStats(data,shift){
  if(!shift)return{messages:0,goal:0,activities:{}};
  const messages=data.messages.filter(m=>m.consultantId===shift.consultantId&&belongsToShift(m,shift,"sentAt"));
  const activities={};
  for(const activity of data.activities.filter(a=>a.consultantId===shift.consultantId&&belongsToShift(a,shift,"createdAt")))activities[activity.type]=(activities[activity.type]||0)+1;
  return{messages:messages.length,goal:(data.consultants.find(c=>c.id===shift.consultantId)||{}).dailyGoal||0,activities};
}
function isAdmin(consultantId){return consultantId===ADMIN_ID;}
function hasActiveShift(data,consultantId){return Boolean(openShift(data,consultantId));}
function canManage(data,requesterId,targetId){return hasActiveShift(data,requesterId)&&(requesterId===targetId||isAdmin(requesterId));}
const CRM_PRIORITIES=new Set(["none","when_possible","important","urgent"]),CRM_STATUSES=new Set(["pending","follow_up","done"]);
function normalizeCrmPayload(body,data,existing={}){const record={...existing,...body},priority=record.priority||"none",status=record.status||"pending";if(!/^\d{4}-\d{2}-\d{2}$/.test(record.date||"")||Number.isNaN(new Date(record.date+"T12:00:00").getTime()))throw new Error("Data inválida.");if(!data.consultants.some(c=>c.id===record.consultantId))throw new Error("Consultor inválido.");if(!String(record.clientName||"").trim()||!String(record.subject||"").trim())throw new Error("Cliente e assunto são obrigatórios.");if(!CRM_PRIORITIES.has(priority))throw new Error("Prioridade inválida.");if(!CRM_STATUSES.has(status))throw new Error("Status inválido.");const completed=body.completed===undefined?status==="done":Boolean(body.completed);return{...record,enrollmentId:String(record.enrollmentId||"").trim(),clientName:String(record.clientName).trim(),priority,subject:String(record.subject).trim(),details:String(record.details||"").trim(),followUp:String(record.followUp||"").trim(),completed,status:completed?"done":status==="done"?"pending":status};}

async function route(req,res){
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`),pathname=url.pathname,method=req.method;let data=db();
  try{
    if(pathname==="/api/bootstrap"&&method==="GET"){
      const current=currentConsultant(data);
      return send(res,200,{consultants:data.consultants.slice().sort((a,b)=>minutes(a.startTime)-minutes(b.startTime)),currentConsultant:current,activeShift:current?openShift(data,current.id):null,activeShifts:data.consultants.filter(c=>openShift(data,c.id)).map(c=>c.id),totals:{allMessages:data.messages.length,todayMessages:data.messages.filter(m=>m.date===today()).length}});
    }

    if(pathname==="/api/crm"&&method==="GET")return send(res,200,data.crmRecords.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt).localeCompare(String(a.createdAt))));
    if(pathname==="/api/crm"&&method==="POST"){
      const b=await parseBody(req);let normalized;try{normalized=normalizeCrmPayload(b,data);}catch(error){return send(res,400,{error:error.message});}
      const stamp=now(),record={id:id("crm"),...normalized,createdAt:stamp,updatedAt:stamp};data.crmRecords.push(record);save(data);return send(res,201,record);
    }
    if(pathname.startsWith("/api/crm/")&&method==="PATCH"){
      const record=data.crmRecords.find(x=>x.id===pathname.split("/").pop());if(!record)return send(res,404,{error:"Registro de CRM não encontrado."});const b=await parseBody(req);let normalized;try{normalized=normalizeCrmPayload(b,data,record);}catch(error){return send(res,400,{error:error.message});}Object.assign(record,normalized,{updatedAt:now()});save(data);return send(res,200,record);
    }
    if(pathname.startsWith("/api/crm/")&&method==="DELETE"){
      const recordId=pathname.split("/").pop(),index=data.crmRecords.findIndex(x=>x.id===recordId);if(index===-1)return send(res,404,{error:"Registro de CRM não encontrado."});const removed=data.crmRecords.splice(index,1)[0];save(data);return send(res,200,{ok:true,id:removed.id});
    }

    if(pathname==="/api/consultants"&&method==="POST"){
      const b=await parseBody(req);if(!isAdmin(b.adminId)||!hasActiveShift(data,b.adminId))return send(res,403,{error:"Acesso administrativo negado."});if(!b.name||!b.startTime)return send(res,400,{error:"Nome e horário são obrigatórios."});
      const c={id:id("c"),name:String(b.name).trim(),startTime:String(b.startTime),dailyGoal:Number(b.dailyGoal)||300,buttonColor:String(b.buttonColor||"#111827"),backgroundColor:String(b.backgroundColor||"#f4f6f8"),photo:String(b.photo||"")};data.consultants.push(c);save(data);return send(res,201,c);
    }
    if(pathname.startsWith("/api/consultants/")&&method==="PATCH"){
      const cid=pathname.split("/").pop(),b=await parseBody(req),c=data.consultants.find(x=>x.id===cid);if(!c)return send(res,404,{error:"Consultor não encontrado."});
      const requesterId=b.adminId||b.consultantId;if(!canManage(data,requesterId,cid))return send(res,403,{error:"Acesso administrativo negado."});
      if(b.name!==undefined)c.name=String(b.name).trim();if(b.startTime!==undefined)c.startTime=String(b.startTime);if(b.dailyGoal!==undefined)c.dailyGoal=Number(b.dailyGoal);if(b.buttonColor!==undefined)c.buttonColor=String(b.buttonColor);if(b.backgroundColor!==undefined)c.backgroundColor=String(b.backgroundColor);if(b.photo!==undefined)c.photo=String(b.photo);save(data);return send(res,200,c);
    }
    if(pathname.startsWith("/api/consultants/")&&method==="DELETE"){
      const cid=pathname.split("/").pop(),b=await parseBody(req);if(!isAdmin(b.adminId)||!hasActiveShift(data,b.adminId)||cid===ADMIN_ID)return send(res,403,{error:"Acesso administrativo negado."});
      data.consultants=data.consultants.filter(c=>c.id!==cid);data.messages=data.messages.filter(x=>x.consultantId!==cid);data.activities=data.activities.filter(x=>x.consultantId!==cid);data.shifts=data.shifts.filter(x=>x.consultantId!==cid);data.cancellationPendings=data.cancellationPendings.filter(x=>x.consultantId!==cid);save(data);return send(res,200,{ok:true});
    }

    if(pathname==="/api/messages"&&method==="POST"){
      const b=await parseBody(req),consultantId=b.consultantId||currentConsultant(data)?.id;if(!consultantId)return send(res,400,{error:"Consultor não identificado."});
      const message={id:id("m"),consultantId,date:b.date||today(),sentAt:b.sentAt||now(),source:b.source||"manual",externalId:b.externalId||null};data.messages.push(message);save(data);return send(res,201,message);
    }
    if(pathname==="/api/messages/adjust"&&method==="POST"){
      const b=await parseBody(req),consultantId=b.consultantId,delta=Number(b.delta),date=b.date||today();if(!consultantId||![-1,1].includes(delta))return send(res,400,{error:"Consultor e ajuste (+1/-1) são obrigatórios."});
      const shift=openShift(data,consultantId);
      if(delta===1){const m={id:id("m"),consultantId,date,sentAt:now(),source:"manual",shiftId:shift?.id||null};data.messages.push(m);save(data);return send(res,201,m);}
      const index=data.messages.findLastIndex(m=>m.consultantId===consultantId&&m.date===date&&shift&&belongsToShift(m,shift,"sentAt"));if(index===-1)return send(res,200,{ok:true,removed:false});const removed=data.messages.splice(index,1)[0];save(data);return send(res,200,{ok:true,removed:true,id:removed.id});
    }
    if(pathname==="/api/webhooks/whatsapp"&&method==="POST"){
      const b=await parseBody(req),consultantId=b.consultantId||currentConsultant(data)?.id;if(!consultantId)return send(res,400,{error:"Não foi possível determinar o consultor."});const exists=b.externalId&&data.messages.some(m=>m.externalId===b.externalId),shift=openShift(data,consultantId),sentAt=b.sentAt||now(),draft={sentAt};if(!exists){data.messages.push({id:id("m"),consultantId,date:businessDate(sentAt),sentAt,source:"whatsapp",externalId:b.externalId||null,shiftId:shift&&belongsToShift(draft,shift,"sentAt")?shift.id:null});save(data);}return send(res,200,{ok:true});
    }
    if(pathname==="/api/activities/adjust"&&method==="POST"){
      const b=await parseBody(req),consultantId=b.consultantId,type=b.type,delta=Number(b.delta),date=b.date||today();if(!consultantId||!type||![-1,1].includes(delta))return send(res,400,{error:"Consultor, atividade e ajuste (+1/-1) são obrigatórios."});
      const shift=openShift(data,consultantId);
      if(delta===1){const a={id:id("a"),consultantId,type,date,createdAt:now(),manual:true,shiftId:shift?.id||null};data.activities.push(a);save(data);return send(res,201,a);}const index=data.activities.findLastIndex(a=>a.consultantId===consultantId&&a.type===type&&a.date===date&&shift&&belongsToShift(a,shift,"createdAt"));if(index===-1)return send(res,200,{ok:true,removed:false});const removed=data.activities.splice(index,1)[0];save(data);return send(res,200,{ok:true,removed:true,id:removed.id});
    }

    if(pathname==="/api/activities"&&method==="POST"){const b=await parseBody(req);if(!b.consultantId||!b.type)return send(res,400,{error:"Consultor e atividade são obrigatórios."});const shift=openShift(data,b.consultantId),a={id:id("a"),consultantId:b.consultantId,type:b.type,date:b.date||today(),createdAt:now(),shiftId:shift?.id||null};data.activities.push(a);save(data);return send(res,201,a);}

    if(pathname==="/api/shifts/start"&&method==="POST"){const b=await parseBody(req),c=data.consultants.find(x=>x.id===b.consultantId);if(!c)return send(res,400,{error:"Consultor inválido."});const open=openShift(data,b.consultantId);if(open)return send(res,200,open);const shift={id:id("s"),consultantId:b.consultantId,date:today(),startedAt:now(),endedAt:null};data.shifts.push(shift);save(data);return send(res,201,shift);}
    if(pathname==="/api/shifts/end"&&method==="POST"){const b=await parseBody(req),shift=openShift(data,b.consultantId);if(!shift)return send(res,404,{error:"Não há expediente aberto para este consultor."});shift.endedAt=now();shift.reportStats=shiftStats(data,shift);const persisted=b.persist!==false;if(!persisted)data.shifts=data.shifts.filter(s=>s.id!==shift.id);save(data);const c=data.consultants.find(x=>x.id===b.consultantId);return send(res,200,{shift,consultant:c,stats:shift.reportStats,persisted});}

    if(pathname==="/api/cancellations"&&method==="POST"){const b=await parseBody(req);if(!b.consultantId)return send(res,400,{error:"Consultor é obrigatório."});const items=Array.isArray(b.items)?b.items.map(x=>({id:String(x.id),label:String(x.label),done:Boolean(x.done)})).filter(x=>x.id&&x.label):[];const pending={id:id("cancel"),consultantId:b.consultantId,date:b.date||today(),createdAt:now(),items};data.cancellationPendings.push(pending);save(data);return send(res,201,pending);}
    if(pathname==="/api/cancellations/pending"&&method==="GET"){const consultantId=url.searchParams.get("consultantId"),date=url.searchParams.get("date")||today();return send(res,200,data.cancellationPendings.filter(p=>p.consultantId===consultantId&&p.date===date&&p.items.some(i=>!i.done)));}
    if(pathname==="/api/cancellations/resolve"&&method==="POST"){const b=await parseBody(req),pending=data.cancellationPendings.find(p=>p.id===b.id);if(!pending)return send(res,404,{error:"Pendência de cancelamento não encontrada."});const item=pending.items.find(i=>i.id===b.itemId);if(!item)return send(res,404,{error:"Item de pendência não encontrado."});item.done=Boolean(b.done);const allDone=pending.items.length>0&&pending.items.every(i=>i.done);let completed=false;if(allDone){const exists=data.activities.some(a=>a.type==="cancelamentos"&&a.consultantId===pending.consultantId&&a.date===pending.date&&a.cancellationId===pending.id);if(!exists)data.activities.push({id:id("a"),consultantId:pending.consultantId,type:"cancelamentos",date:pending.date,createdAt:now(),cancellationId:pending.id});pending.completedAt=now();completed=true;}save(data);return send(res,200,{ok:true,completed,pending});}

    if(pathname.startsWith("/api/consultants/")&&pathname.endsWith("/delete-day")&&method==="POST"){const parts=pathname.split("/"),cid=parts[3],b=await parseBody(req),date=b.date||today();if(!canManage(data,b.requesterId,cid))return send(res,403,{error:"Acesso negado."});data.messages=data.messages.filter(m=>!(m.consultantId===cid&&m.date===date));data.activities=data.activities.filter(a=>!(a.consultantId===cid&&a.date===date));data.shifts=data.shifts.filter(s=>!(s.consultantId===cid&&s.date===date));data.cancellationPendings=data.cancellationPendings.filter(p=>!(p.consultantId===cid&&p.date===date));save(data);return send(res,200,{ok:true,date});}
    if(pathname.startsWith("/api/consultants/")&&pathname.endsWith("/delete-all")&&method==="POST"){const parts=pathname.split("/"),cid=parts[3],b=await parseBody(req);if(!canManage(data,b.requesterId,cid))return send(res,403,{error:"Acesso negado."});data.messages=data.messages.filter(m=>m.consultantId!==cid);data.activities=data.activities.filter(a=>a.consultantId!==cid);data.shifts=data.shifts.filter(s=>s.consultantId!==cid);data.cancellationPendings=data.cancellationPendings.filter(p=>p.consultantId!==cid);save(data);return send(res,200,{ok:true});}

    if(pathname==="/api/session"&&method==="GET"){const cid=url.searchParams.get("consultantId"),c=data.consultants.find(x=>x.id===cid);if(!c)return send(res,404,{error:"Consultor não encontrado."});return send(res,200,{consultant:c,shift:openShift(data,cid)});}
    if(pathname==="/api/session-stats"&&method==="GET"){const cid=url.searchParams.get("consultantId"),shift=openShift(data,cid);if(!data.consultants.some(c=>c.id===cid))return send(res,404,{error:"Consultor não encontrado."});return send(res,200,shiftStats(data,shift));}
    if(pathname==="/api/stats"&&method==="GET"){
      const date=url.searchParams.get("date")||today(),rows=data.consultants.map(c=>{const s=stats(data,c.id,date),all=data.messages.filter(m=>m.consultantId===c.id),days=new Set(all.map(m=>m.date)).size;return {...c,...s,average:days?Math.round(all.length/days):0};});
      return send(res,200,{date,totalMessages:data.messages.filter(m=>m.date===date).length,allMessages:data.messages.length,rows});
    }
    if(pathname==="/api/history"&&method==="GET"){const limit=Math.min(Number(url.searchParams.get("limit")||100),500);return send(res,200,data.shifts.slice().sort((a,b)=>String(b.endedAt||b.startedAt||"").localeCompare(String(a.endedAt||a.startedAt||""))).slice(0,limit).map(s=>{const c=data.consultants.find(x=>x.id===s.consultantId),st=s.reportStats||shiftStats(data,s);return {...s,consultantName:c?.name||"—",consultantPhoto:c?.photo||"",stats:st,isCurrent:isShiftCurrent(s,c?.startTime)};}));}

    let file=pathname==="/"?"/index.html":pathname;const safe=path.normalize(file).replace(/^(\.\.[\/\\])+/,"");const full=path.join(PUBLIC_DIR,safe);if(fs.existsSync(full)&&fs.statSync(full).isFile()){const ext=path.extname(full),types={".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json",".svg":"image/svg+xml"};return send(res,200,fs.readFileSync(full),types[ext]||"application/octet-stream");}
    return send(res,404,{error:"Rota não encontrada."});
  }catch(e){console.error(e);return send(res,500,{error:e.message});}
}
http.createServer(route).listen(PORT,HOST,()=>console.log(`EVOLVE Produtividade: http://localhost:${PORT}`));
