import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {defaultConfig,findAnswer} from './tobi-content.js';
import {createConnectionStore,requestTobiAI} from './tobi-ai.js';
import {createPublicAccessStore} from './tobi-public.js';

const digest=value=>createHash('sha256').update(value).digest();
const invalid=message=>Object.assign(new Error(message||'invalid_fields'),{status:400});
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const bilingual=(v,max)=>v&&Object.keys(v).sort().join(',')==='ar,en'&&text(v.ar,max)&&text(v.en,max);
export function validateConfig(c){
 if(!c||typeof c!=='object'||Object.keys(c).sort().join(',')!==Object.keys(defaultConfig).sort().join(','))throw invalid();
 if(!bilingual(c.greeting,150))throw invalid();
 for(const key of ['animations','chatEnabled','questEnabled','wordsEnabled','riddlesEnabled','openAIEnabled'])if(typeof c[key]!=='boolean')throw invalid();
 if(!Array.isArray(c.answers)||c.answers.length<1||c.answers.length>40||!Array.isArray(c.questions)||c.questions.length<1||c.questions.length>10)throw invalid();
 for(const rows of [c.answers,c.questions])if(new Set(rows.map(r=>r?.id)).size!==rows.length)throw invalid();
 for(const a of c.answers){
  if(!a||Object.keys(a).sort().join(',')!=='answer,id,keywords,q'||!text(a.id,50)||!bilingual(a.q,180)||!bilingual(a.answer,1200)||!Array.isArray(a.keywords)||a.keywords.length>12||a.keywords.some(k=>!text(k,60)))throw invalid();
 }
 for(const q of c.questions){
  if(!q||Object.keys(q).sort().join(',')!=='correct,id,options,q,why'||!text(q.id,50)||!bilingual(q.q,220)||!bilingual(q.why,500)||!Array.isArray(q.options)||q.options.length!==3||!q.options.every(o=>bilingual(o,160))||!Number.isInteger(q.correct)||q.correct<0||q.correct>2)throw invalid();
 }
 return c;
}

export async function createTobi({db,dataDir,body,session,secureCookies=false,apiKey=process.env.OPENAI_API_KEY||'',model=process.env.OPENAI_MODEL||'gpt-5.6-luna',aiFetch=fetch,dailyLimit=50,aiTimeoutMs=15000}){
 db.exec(`CREATE TABLE IF NOT EXISTS tobi_config (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL, revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tobi_owner (id INTEGER PRIMARY KEY CHECK(id=1), user_id TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS tobi_setup (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tobi_progress (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, best INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS tobi_usage (day TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,user_id));`);
 db.prepare('INSERT OR IGNORE INTO tobi_config VALUES (1,?,1)').run(JSON.stringify(defaultConfig));
 const connectionStore = await createConnectionStore(db, dataDir, apiKey, model);
 const publicAccess = await createPublicAccessStore({db,dataDir,dailyLimit,secureCookies});
 const owner=()=>db.prepare('SELECT user_id FROM tobi_owner WHERE id=1').get()?.user_id;
 const isOwner=user=>!!user&&owner()===user.id;
 const read=()=>{const row=db.prepare('SELECT * FROM tobi_config WHERE id=1').get();return {config:JSON.parse(row.document),revision:row.revision};};
 if(!owner()&&!db.prepare('SELECT id FROM tobi_setup WHERE id=1').get()){
  const code=randomBytes(24).toString('hex');
  await writeFile(path.join(dataDir,'tobi-owner-code.txt'),code+'\n',{mode:0o600});
  db.prepare('INSERT INTO tobi_setup VALUES (1,?)').run(digest(code).toString('hex'));
 }
 const claimAttempts=new Map(),chatAttempts=new Map(),connectionAttempts=new Map(),active=new Map();
 const rate=(map,key,max)=>{const now=Date.now();for(const [k,v] of map)if(v.until<now)map.delete(k);const v=map.get(key)||{n:0,until:now+60000};v.n++;map.set(key,v);return v.n<=max;};
 const fallback=lang=>lang==='ar'?'مش عندي إجابة محفوظة عن ده لسه. نقدر نتكلم عن التنمّر أو الخصوصية أو حماية حسابك أو مساعدة صاحبك.':'I don’t have a notebook answer for that yet. Try asking about bullying, passwords, privacy, or helping a friend.';
 function connectionStatus(userId) {
  const current=connectionStore.current(),policy=publicAccess.read();
  return {keyConfigured:!!current.apiKey,source:current.source,model:current.model,enabled:read().config.openAIEnabled,policy,dailyLimit:policy.siteDailyLimit,userDailyLimit:policy.visitorDailyLimit,usage:publicAccess.usage(userId),lastTest:current.lastTest};
 }
 function abortActive() { for(const controller of active.values())controller.abort(); }
 async function performAI({user,req,res,connection,language,message,history=[],testing=false}) {
  const visitorId=publicAccess.visitor(req,res,user);
  if(active.has(visitorId)||active.size>=3)return {ok:false,reason:'busy'};
  const limitReason=publicAccess.reserve(visitorId,publicAccess.network(req));
  if(limitReason)return {ok:false,reason:limitReason};
  const controller=new AbortController();
  active.set(visitorId,controller);
  const timeout=setTimeout(()=>controller.abort(),aiTimeoutMs);
  const cancel=()=>{if(!res.writableEnded)controller.abort();};
  res.on('close',cancel);
  try {
   return await requestTobiAI({connection,aiFetch,signal:controller.signal,language,message,history,testing});
  } finally {
   clearTimeout(timeout);
   res.off('close',cancel);
   active.delete(visitorId);
  }
 }
 return async function handle(req,res,url,json){
  if(!url.pathname.startsWith('/api/tobi/'))return false;
  const user=session(req),state=read(),c=state.config;
  const send=(status,data)=>{if(!res.destroyed)json(res,status,data);return true;};
  const policy=publicAccess.read(),aiAvailable=!!connectionStore.current().apiKey&&c.openAIEnabled;
  const reason=!c.openAIEnabled||!c.chatEnabled?'disabled':!connectionStore.current().apiKey?'not_configured':policy.audience==='members'&&!user?'login_required':null;
  const aiAccess={audience:policy.audience,ready:reason===null,reason};
  if(url.pathname==='/api/tobi/config'&&req.method==='GET')return send(200,{...state,aiAvailable,aiAccess});
  if(url.pathname==='/api/tobi/access'&&req.method==='GET'){
   const connection=isOwner(user)?connectionStatus(user.id):null;
   return send(200,{ownerConfigured:!!owner(),canEdit:isOwner(user),aiAvailable,aiAccess,...(connection?{keyConfigured:connection.keyConfigured,model:connection.model,dailyLimit:policy.siteDailyLimit,connection}: {})});
  }
  if(url.pathname==='/api/tobi/policy'){
   if(!user)return send(401,{error:'unauthorized'});
   if(!isOwner(user))return send(403,{error:'forbidden'});
   if(req.method==='GET')return send(200,{policy});
   if(req.method==='PUT'){
    const next=publicAccess.save(await body(req));
    if(next.audience!==policy.audience)abortActive();
    return send(200,{policy:next,connection:connectionStatus(user.id)});
   }
   return send(405,{error:'invalid_request'});
  }
  if(url.pathname==='/api/tobi/claim'&&req.method==='POST'){
   if(!user)return send(401,{error:'unauthorized'});
   if(owner())return send(409,{error:'owner_already_set'});
   if(!rate(claimAttempts,req.clientAddress,5))return send(429,{error:'too_many_attempts'});
   const input=await body(req),stored=db.prepare('SELECT token_hash FROM tobi_setup WHERE id=1').get();
   if(typeof input.code!=='string'||input.code.length>100||!stored||!timingSafeEqual(digest(input.code.trim()),Buffer.from(stored.token_hash,'hex')))return send(403,{error:'invalid_setup_code'});
   db.prepare('INSERT INTO tobi_owner VALUES(1,?)').run(user.id);
   db.prepare('DELETE FROM tobi_setup').run();
   await writeFile(path.join(dataDir,'tobi-owner-code.txt'),'Owner setup complete. This code is no longer valid.\n',{mode:0o600});
   return send(200,{ok:true});
  }
  if(['/api/tobi/connection','/api/tobi/connection/test','/api/tobi/connection/remove'].includes(url.pathname)){
   if(!user)return send(401,{error:'unauthorized'});
   if(!isOwner(user))return send(403,{error:'forbidden'});
   if(url.pathname==='/api/tobi/connection'&&req.method==='GET')return send(200,connectionStatus(user.id));
   if(url.pathname==='/api/tobi/connection'&&req.method==='PUT'){
    const input=await body(req);
    const previous=connectionStore.current().generation;
    const saved=await connectionStore.save(input);
    if(saved.generation!==previous)abortActive();
    return send(200,{connection:connectionStatus(user.id)});
   }
   if(url.pathname==='/api/tobi/connection/remove'&&req.method==='POST'){
    await body(req);
    await connectionStore.remove();
    abortActive();
    const latest=read();
    if(latest.config.openAIEnabled){
     latest.config.openAIEnabled=false;
     db.prepare('UPDATE tobi_config SET document=?,revision=revision+1 WHERE id=1').run(JSON.stringify(latest.config));
    }
    return send(200,{connection:connectionStatus(user.id),...read()});
   }
   if(url.pathname==='/api/tobi/connection/test'&&req.method==='POST'){
    await body(req);
    if(!rate(connectionAttempts,user.id,5))return send(429,{error:'too_many_attempts'});
    const connection=connectionStore.current();
    if(!connection.apiKey)return send(200,{ok:false,reason:'key_missing',connection:connectionStatus(user.id)});
    const result=await performAI({user,req,res,connection,language:'en',message:'Reply only with OK.',testing:true});
    if(connectionStore.current().generation!==connection.generation)return send(200,{ok:false,reason:'settings_changed',connection:connectionStatus(user.id)});
    connectionStore.recordTest(connection.generation,result);
    return send(200,{ok:result.ok,reason:result.reason||null,connection:connectionStatus(user.id)});
   }
   return send(405,{error:'invalid_request'});
  }
  if(url.pathname==='/api/tobi/admin'&&['GET','PUT'].includes(req.method)){
   if(!user)return send(401,{error:'unauthorized'});
   if(!isOwner(user))return send(403,{error:'forbidden'});
   if(req.method==='GET')return send(200,state);
   const input=await body(req,65536);
   if(!Number.isInteger(input.revision))throw invalid();
   const next=validateConfig(input.config);
   if(next.openAIEnabled&&!connectionStore.current().apiKey)return send(400,{error:'key_missing'});
   const changed=db.prepare('UPDATE tobi_config SET document=?, revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify(next),input.revision);
   if(!changed.changes)return send(409,{error:'settings_changed'});
   if(!next.openAIEnabled||!next.chatEnabled)abortActive();
   return send(200,read());
  }
  if(url.pathname==='/api/tobi/progress'&&['GET','PUT'].includes(req.method)){
   if(!user)return send(401,{error:'unauthorized'});
   db.prepare('INSERT OR IGNORE INTO tobi_progress(user_id) VALUES(?)').run(user.id);
   if(req.method==='PUT'){
    const input=await body(req);
    if(Object.keys(input).join(',')!=='score'||!Number.isInteger(input.score)||input.score<0||input.score>100)throw invalid();
    db.prepare('UPDATE tobi_progress SET best=MAX(best,?),rounds=rounds+1 WHERE user_id=?').run(input.score,user.id);
   }
   return send(200,db.prepare('SELECT best,rounds FROM tobi_progress WHERE user_id=?').get(user.id));
  }
  if(url.pathname==='/api/tobi/chat'&&req.method==='POST'){
   if(!rate(chatAttempts,req.clientAddress,30))return send(429,{error:'too_many_attempts'});
   const input=await body(req,24576),lang=input.language==='ar'?'ar':'en';
   if(!text(input.message,500)||!['en','ar'].includes(input.language)||(input.mode!==undefined&&!['auto','ai'].includes(input.mode)))throw invalid();
   const history=input.history??[];
   if(!Array.isArray(history)||history.length>6||history.some(m=>!m||!['user','assistant'].includes(m.role)||!text(m.content,1000)))throw invalid();
   const latestConfig=read().config;
   if(!latestConfig.chatEnabled)return send(403,{error:'activity_disabled'});
   const known=input.mode==='ai'?null:findAnswer(input.message,latestConfig,lang);
   if(known)return send(200,{answer:known,source:'notebook'});
   const fail=reason=>send(200,{answer:fallback(lang),source:'notebook',reason});
   const connection=connectionStore.current();
   if(!latestConfig.openAIEnabled||!connection.apiKey)return fail('free_mode');
   if(publicAccess.read().audience==='members'&&!user)return fail('login_required');
   const result=await performAI({user,req,res,connection,language:lang,message:input.message,history});
   if(!result.ok)return fail(result.reason);
   return send(200,{answer:result.answer,source:'openai'});
  }
  return send(404,{error:'not_found'});
 };
}
