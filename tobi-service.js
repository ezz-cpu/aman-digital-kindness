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

export async function createTobi({db,dataDir,body,session,requestLimits,secureCookies=false,masterSecret='',ownerCode='',apiKey=process.env.OPENAI_API_KEY||'',model=process.env.OPENAI_MODEL||'gpt-5.6-luna',aiFetch=fetch,dailyLimit=50,aiTimeoutMs=15000}){
 await db.transaction(tx=>tx.exec(`CREATE TABLE IF NOT EXISTS tobi_config (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL, revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tobi_owner (id INTEGER PRIMARY KEY CHECK(id=1), user_id TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS tobi_setup (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tobi_progress (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, best INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS tobi_usage (day TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,user_id));`));
 await db.run('INSERT INTO tobi_config VALUES (1,?,1) ON CONFLICT(id) DO NOTHING',JSON.stringify(defaultConfig));
 const connectionStore = await createConnectionStore(db, dataDir, apiKey, model, masterSecret);
 const publicAccess = await createPublicAccessStore({db,dataDir,dailyLimit,secureCookies,masterSecret});
 const owner=async ()=>(await db.get('SELECT user_id FROM tobi_owner WHERE id=1'))?.user_id;
 const isOwner=async user=>!!user&&await owner()===user.id;
 const read=async ()=>{const row=await db.get('SELECT * FROM tobi_config WHERE id=1');return {config:JSON.parse(row.document),revision:row.revision};};
 await db.transaction(async tx=>{
  if(!await tx.get('SELECT user_id FROM tobi_owner WHERE id=1')&&!await tx.get('SELECT id FROM tobi_setup WHERE id=1')){
   const code=ownerCode.trim()||randomBytes(24).toString('hex');
   if(!ownerCode)await writeFile(path.join(dataDir,'tobi-owner-code.txt'),code+'\n',{mode:0o600});
   await tx.run('INSERT INTO tobi_setup VALUES (1,?)',digest(code).toString('hex'));
  }
 });
 const active=new Map();
 const rate=async(scope,key,max)=>(await requestLimits.consume(scope,key,max,60000)).allowed;
 const fallback=lang=>lang==='ar'?'مش عندي إجابة محفوظة عن ده لسه. نقدر نتكلم عن التنمّر أو الخصوصية أو حماية حسابك أو مساعدة صاحبك.':'I don’t have a notebook answer for that yet. Try asking about bullying, passwords, privacy, or helping a friend.';
 async function connectionStatus(userId) {
  const [current,policy,state,usage]=await Promise.all([connectionStore.current(),publicAccess.read(),read(),publicAccess.usage(userId)]);
  return {keyConfigured:!!current.apiKey,source:current.source,model:current.model,enabled:state.config.openAIEnabled,policy,dailyLimit:policy.siteDailyLimit,userDailyLimit:policy.visitorDailyLimit,usage,lastTest:current.lastTest};
 }
 function abortActive() { for(const controller of active.values())controller.abort(); }
 async function performAI({user,req,res,connection,language,message,history=[],testing=false}) {
  const visitorId=publicAccess.visitor(req,res,user);
  if(active.has(visitorId)||active.size>=3)return {ok:false,reason:'busy'};
  const controller=new AbortController();
  // Claim the in-process slot before the first database await.
  active.set(visitorId,controller);
  const timeout=setTimeout(()=>controller.abort(),aiTimeoutMs);
  const cancel=()=>{if(!res.writableEnded)controller.abort();};
  res.on('close',cancel);
  let lease;
  try {
   lease=await requestLimits.acquire('tobi-ai',visitorId,3,Math.max(60000,aiTimeoutMs+10000));
   if(!lease)return {ok:false,reason:'busy'};
   const limitReason=await publicAccess.reserve(visitorId,publicAccess.network(req));
   if(limitReason)return {ok:false,reason:limitReason};
   const [latest,latestPolicy,latestConnection]=await Promise.all([read(),publicAccess.read(),connectionStore.current()]);
   if(latestConnection.generation!==connection.generation||latestConnection.apiKey!==connection.apiKey)return {ok:false,reason:'settings_changed'};
   if(!testing&&(!latest.config.openAIEnabled||!latest.config.chatEnabled))return {ok:false,reason:'free_mode'};
   if(!testing&&latestPolicy.audience==='members'&&!user)return {ok:false,reason:'login_required'};
   if(controller.signal.aborted)return {ok:false,reason:'request_timeout'};
   const result=await requestTobiAI({connection,aiFetch,signal:controller.signal,language,message,history,testing});
   if(!result.ok)return result;
   const [after,afterPolicy,afterConnection]=await Promise.all([read(),publicAccess.read(),connectionStore.current()]);
   if(afterConnection.generation!==connection.generation||afterConnection.apiKey!==connection.apiKey)return {ok:false,reason:'settings_changed'};
   if(!testing&&(!after.config.openAIEnabled||!after.config.chatEnabled))return {ok:false,reason:'free_mode'};
   if(!testing&&afterPolicy.audience==='members'&&!user)return {ok:false,reason:'login_required'};
   return result;
  } finally {
   clearTimeout(timeout);
   res.off('close',cancel);
   active.delete(visitorId);
   await requestLimits.release(lease).catch(()=>console.error('An AI request slot could not be released.'));
  }
 }
 return async function handle(req,res,url,json){
  if(!url.pathname.startsWith('/api/tobi/'))return false;
  const [user,state,policy,currentConnection]=await Promise.all([session(req),read(),publicAccess.read(),connectionStore.current()]);
  const c=state.config;
  const send=(status,data)=>{if(!res.destroyed)json(res,status,data);return true;};
  const aiAvailable=!!currentConnection.apiKey&&c.openAIEnabled;
  const reason=!c.openAIEnabled||!c.chatEnabled?'disabled':!currentConnection.apiKey?'not_configured':policy.audience==='members'&&!user?'login_required':null;
  const aiAccess={audience:policy.audience,ready:reason===null,reason};
  if(url.pathname==='/api/tobi/config'&&req.method==='GET')return send(200,{...state,aiAvailable,aiAccess});
  if(url.pathname==='/api/tobi/access'&&req.method==='GET'){
   const canEdit=await isOwner(user),connection=canEdit?await connectionStatus(user.id):null;
   return send(200,{ownerConfigured:!!await owner(),canEdit,aiAvailable,aiAccess,...(connection?{keyConfigured:connection.keyConfigured,model:connection.model,dailyLimit:policy.siteDailyLimit,connection}: {})});
  }
  if(url.pathname==='/api/tobi/policy'){
   if(!user)return send(401,{error:'unauthorized'});
   if(!await isOwner(user))return send(403,{error:'forbidden'});
   if(req.method==='GET')return send(200,{policy});
   if(req.method==='PUT'){
    const next=await publicAccess.save(await body(req));
    if(next.audience!==policy.audience)abortActive();
    return send(200,{policy:next,connection:await connectionStatus(user.id)});
   }
   return send(405,{error:'invalid_request'});
  }
  if(url.pathname==='/api/tobi/claim'&&req.method==='POST'){
   if(!user)return send(401,{error:'unauthorized'});
   if(await owner())return send(409,{error:'owner_already_set'});
   if(!await rate('tobi-claim',req.clientAddress,5))return send(429,{error:'too_many_attempts'});
   const input=await body(req);
   const claim=await db.transaction(async tx=>{
    if(await tx.get('SELECT user_id FROM tobi_owner WHERE id=1'))return {status:409,error:'owner_already_set'};
    const stored=await tx.get('SELECT token_hash FROM tobi_setup WHERE id=1');
    if(typeof input.code!=='string'||input.code.length>100||!stored||!timingSafeEqual(digest(input.code.trim()),Buffer.from(stored.token_hash,'hex')))return {status:403,error:'invalid_setup_code'};
    await tx.run('INSERT INTO tobi_owner VALUES(1,?)',user.id);
    await tx.run('DELETE FROM tobi_setup');
    return {status:200};
   });
   if(claim.error)return send(claim.status,{error:claim.error});
   if(!ownerCode)await writeFile(path.join(dataDir,'tobi-owner-code.txt'),'Owner setup complete. This code is no longer valid.\n',{mode:0o600});
   return send(200,{ok:true});
  }
  if(['/api/tobi/connection','/api/tobi/connection/test','/api/tobi/connection/remove'].includes(url.pathname)){
   if(!user)return send(401,{error:'unauthorized'});
   if(!await isOwner(user))return send(403,{error:'forbidden'});
   if(url.pathname==='/api/tobi/connection'&&req.method==='GET')return send(200,await connectionStatus(user.id));
   if(url.pathname==='/api/tobi/connection'&&req.method==='PUT'){
    const input=await body(req);
    const previous=(await connectionStore.current()).generation;
    const saved=await connectionStore.save(input);
    if(saved.generation!==previous)abortActive();
    return send(200,{connection:await connectionStatus(user.id)});
   }
   if(url.pathname==='/api/tobi/connection/remove'&&req.method==='POST'){
    await body(req);
    await connectionStore.remove();
    abortActive();
    const latest=await read();
    if(latest.config.openAIEnabled){
     latest.config.openAIEnabled=false;
     await db.run('UPDATE tobi_config SET document=?,revision=revision+1 WHERE id=1',JSON.stringify(latest.config));
    }
    return send(200,{connection:await connectionStatus(user.id),...await read()});
   }
   if(url.pathname==='/api/tobi/connection/test'&&req.method==='POST'){
    await body(req);
    if(!await rate('tobi-connection',user.id,5))return send(429,{error:'too_many_attempts'});
    const connection=await connectionStore.current();
    if(!connection.apiKey)return send(200,{ok:false,reason:'key_missing',connection:await connectionStatus(user.id)});
    const result=await performAI({user,req,res,connection,language:'en',message:'Reply only with OK.',testing:true});
    if((await connectionStore.current()).generation!==connection.generation)return send(200,{ok:false,reason:'settings_changed',connection:await connectionStatus(user.id)});
    await connectionStore.recordTest(connection.generation,result);
    return send(200,{ok:result.ok,reason:result.reason||null,connection:await connectionStatus(user.id)});
   }
   return send(405,{error:'invalid_request'});
  }
  if(url.pathname==='/api/tobi/admin'&&['GET','PUT'].includes(req.method)){
   if(!user)return send(401,{error:'unauthorized'});
   if(!await isOwner(user))return send(403,{error:'forbidden'});
   if(req.method==='GET')return send(200,state);
   const input=await body(req,65536);
   if(!Number.isInteger(input.revision))throw invalid();
   const next=validateConfig(input.config);
   if(next.openAIEnabled&&!(await connectionStore.current()).apiKey)return send(400,{error:'key_missing'});
   const changed=await db.run('UPDATE tobi_config SET document=?, revision=revision+1 WHERE id=1 AND revision=?',JSON.stringify(next),input.revision);
   if(!changed.changes)return send(409,{error:'settings_changed'});
   if(!next.openAIEnabled||!next.chatEnabled)abortActive();
   return send(200,await read());
  }
  if(url.pathname==='/api/tobi/progress'&&['GET','PUT'].includes(req.method)){
   if(!user)return send(401,{error:'unauthorized'});
   await db.run('INSERT INTO tobi_progress(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING',user.id);
   if(req.method==='PUT'){
    const input=await body(req);
    if(Object.keys(input).join(',')!=='score'||!Number.isInteger(input.score)||input.score<0||input.score>100)throw invalid();
    await db.run('UPDATE tobi_progress SET best=CASE WHEN best<? THEN ? ELSE best END,rounds=rounds+1 WHERE user_id=?',input.score,input.score,user.id);
   }
   return send(200,await db.get('SELECT best,rounds FROM tobi_progress WHERE user_id=?',user.id));
  }
  if(url.pathname==='/api/tobi/chat'&&req.method==='POST'){
   if(!await rate('tobi-chat',req.clientAddress,30))return send(429,{error:'too_many_attempts'});
   const input=await body(req,24576),lang=input.language==='ar'?'ar':'en';
   if(!text(input.message,500)||!['en','ar'].includes(input.language)||(input.mode!==undefined&&!['auto','ai'].includes(input.mode)))throw invalid();
   const history=input.history??[];
   if(!Array.isArray(history)||history.length>6||history.some(m=>!m||!['user','assistant'].includes(m.role)||!text(m.content,1000)))throw invalid();
   const latestConfig=(await read()).config;
   if(!latestConfig.chatEnabled)return send(403,{error:'activity_disabled'});
   const known=input.mode==='ai'?null:findAnswer(input.message,latestConfig,lang);
   if(known)return send(200,{answer:known,source:'notebook'});
   const fail=reason=>send(200,{answer:fallback(lang),source:'notebook',reason});
   const connection=await connectionStore.current();
   if(!latestConfig.openAIEnabled||!connection.apiKey)return fail('free_mode');
   if((await publicAccess.read()).audience==='members'&&!user)return fail('login_required');
   const result=await performAI({user,req,res,connection,language:lang,message:input.message,history});
   if(!result.ok)return fail(result.reason);
   return send(200,{answer:result.answer,source:'openai'});
  }
  return send(404,{error:'not_found'});
 };
}
