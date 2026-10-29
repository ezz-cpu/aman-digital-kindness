import {defaultConfig,findAnswer,words,riddles,normalize} from './tobi-content.js';
const root=document.querySelector('#tobi-app'),studio=document.body.dataset.studio==='true';
const e=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readLocal=(k,fallback)=>{try{return localStorage.getItem(k)||fallback;}catch{return fallback;}};
let lang=readLocal('aman-language','ar'),config=structuredClone(defaultConfig),revision=1,draft=null,dirty=false,user=null,access={},aiAvailable=false,connected=true,aiAccess={audience:'members',ready:false,reason:'disabled'};
let view='home',sound=false,best=0,messages=[],chatNotice='',pending=false,requestId=0,controller=null;
let chatMode='auto',chatDraft='',companionMood=0,connection=null,connectionBusy=false,connectionMessage='',connectionError=false;
const fileMode=location.protocol==='file:';
let quiz={index:0,selected:null,correct:0,done:false,save:''},wordResult=null,riddleIndex=0,riddleResult='',editorTab='settings',selectedAnswer=0,selectedQuestion=0,studioMessage='';
const t=(en,ar)=>lang==='ar'?ar:en;
const canUseAI=()=>connected&&config.chatEnabled&&aiAvailable&&(aiAccess.ready??(aiAccess.audience==='public'||!!user));
function acceptAIConfig(result){
 config=result.config;revision=result.revision;aiAvailable=!!result.aiAvailable;
 aiAccess=result.aiAccess||{audience:'members',ready:aiAvailable&&!!user,reason:aiAvailable?'login_required':'disabled'};
}
async function refreshAIState(signal){
 if(fileMode){connected=false;return;}
 try{const result=await api('/api/tobi/config',{signal});acceptAIConfig(result);connected=true;}
 catch(error){if(error.name==='AbortError')throw error;connected=false;}
}
function unavailableAI(){
 if(fileMode)return t('Open Aman.cmd from the website folder, then open Tobi from the running site to use AI.','افتح Open Aman.cmd من فولدر الموقع، وبعدها افتح توبي من الموقع عشان تستخدم AI.');
 if(!connected)return t('The server is unavailable. Try AI again when the connection returns.','السيرفر مش متاح دلوقتي. جرّب زر AI تاني لما الاتصال يرجع.');
 return aiReason(aiAccess.reason||(!aiAvailable?'disabled':'login_required'));
}
function aiHelpLink(){
 if(fileMode)return ` <a href="http://127.0.0.1:3000/tobi.html#chat">${t('Open the running site','افتح الموقع لو شغّال')} ↗</a>`;
 if(aiAccess.reason==='login_required')return ` <a href="login.html?next=tobi.html">${t('Log in','سجّل الدخول')}</a>`;
 if(access.canEdit&&!canUseAI())return ` <a href="tobi-studio.html#ai">${t('Open AI settings','افتح إعدادات AI')}</a>`;
 return '';
}
const tr=v=>v?.[lang]||v?.en||'';
const portrait=(jump=false)=>`<div class="portrait"><img class="base-frame" src="tobi-assets/${jump?'tobi-jump':'tobi'}.svg" alt="${t('Tobi, your digital-safety buddy','توبي، صديقك للأمان الرقمي')}">${jump?'':'<img class="blink-frame" src="tobi-assets/tobi-blink.svg" alt="" aria-hidden="true">'}</div>`;
const activityInfo=()=>[
 {id:'chat',icon:'☏',name:t('Talk to Tobi','تحدث مع توبي'),description:t('A friendly space for questions, big and small.','مساحة ودودة لأسئلتك الكبيرة والصغيرة.'),tag:t('Ask & discover','اسأل واكتشف'),enabled:config.chatEnabled},
 {id:'quest',icon:'✧',name:t('Safety Quest','مهمة الأمان'),description:t('Your choices. A kinder internet. Take the challenge.','اختياراتك تصنع إنترنت ألطف. جرّب التحدي.'),tag:t(`${config.questions.length} small adventures`,`${config.questions.length} مغامرات صغيرة`),enabled:config.questEnabled},
 {id:'words',icon:'Aa',name:t('Word Lab','مختبر الكلمات'),description:t('Find new ways to say it. Explore English words.','اكتشف طرقاً جديدة للتعبير بالكلمات الإنجليزية.'),tag:t('16 words to explore','١٦ كلمة لاكتشافها'),enabled:config.wordsEnabled},
 {id:'riddles',icon:'▸',name:t('Movie Riddles','ألغاز الأفلام'),description:t('A few emojis. One movie. Can you work it out?','بضعة رموز وفيلم واحد. هل تستطيع تخمينه؟'),tag:t('Guess the story','خمّن القصة'),enabled:config.riddlesEnabled},
];
async function api(url,options={}){
 if(fileMode)throw new Error('offline');
 const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
 let data;try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw new Error('offline');}
 if(!response.ok)throw new Error(data.error||'server_error');return data;
}
const errorText=error=>({unauthorized:t('Please log in again.','يرجى تسجيل الدخول مجدداً.'),forbidden:t('Only the site owner can edit Tobi.','مالك الموقع فقط يمكنه تعديل توبي.'),invalid_setup_code:t('That setup code is not correct. Copy it from the local owner-code file.','رمز الإعداد غير صحيح. انسخه من ملف رمز المالك المحلي.'),owner_already_set:t('This site already has an owner. Log in with the owner account.','يوجد مالك لهذا الموقع بالفعل. سجّل الدخول بحساب المالك.'),too_many_attempts:t('Please wait a minute before trying again.','انتظر دقيقة ثم حاول مجدداً.'),settings_changed:t('Someone saved newer settings. Reload this page before editing again.','تم حفظ إعدادات أحدث. أعد تحميل الصفحة قبل التعديل مجدداً.'),key_missing:t('Add a key in the AI connection tab first.','أضف المفتاح من تبويب ربط AI أولًا.'),invalid_fields:t('Check every field: both languages, three quiz choices, and no empty answers.','راجع الحقول: اللغتان وثلاثة اختيارات لكل سؤال وإجابات غير فارغة.')}[error.message]||t('Could not connect. Your game still works; please try saving again.','تعذر الاتصال. ما زالت اللعبة تعمل؛ حاول الحفظ مجدداً.'));
function header(){return `<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark">◇</span>${t('amān','أمان')}<small>${t('a kinder internet','لإنترنت ألطف')}</small></a><div class="top-actions"><a href="${studio?'tobi.html':'tobi-studio.html'}" aria-label="${studio?t('Open Tobi game','افتح لعبة توبي'):t('Open Tobi Studio','افتح استوديو توبي')}">⚙</a><a href="interactive.html">${t('Learn & play','تعلّم والعب')}</a><button class="quiet-button" data-action="language" aria-label="${t('Switch to Arabic','Switch to English')}">${t('عربي','EN')}</button>${user?`<a class="account-name" href="dashboard.html">${e(user.name)}</a>`:`<a href="login.html?next=${studio?'tobi-studio':'tobi'}.html">${t('Log in','دخول')}</a>`}</div></header>`;}
function sidebar(){return `<aside class="sidebar"><div><span class="sidebar-label">${t('Your safe space','مساحتك الآمنة')}</span><nav class="mission-nav" aria-label="${t('Tobi activities','أنشطة توبي')}"><button data-view="home" ${view==='home'&&!studio?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">⌂</span>${t('Mission home','الرئيسية')}</button>${activityInfo().filter(a=>a.enabled).map(a=>`<button data-view="${a.id}" ${view===a.id&&!studio?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${a.icon}</span>${a.name}</button>`).join('')}</nav></div><div class="sidebar-note"><span>✦</span><strong>${t('A little reminder','تذكير صغير')}</strong><p>${t('Your voice matters. You deserve to feel safe, online and off.','صوتك مهم. أنت تستحق الشعور بالأمان داخل الإنترنت وخارجه.')}</p></div><div class="sidebar-bottom"><a href="${studio?'tobi.html':'tobi-studio.html'}">${studio?t('← Back to the game','← العودة للعبة'):t('⚙ Tobi Studio','⚙ استوديو توبي')}</a></div></aside>`;}
function render(){
 document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.body.classList.toggle('animate',config.animations);
 const label=studio?t('Tobi Studio','استوديو توبي'):view==='home'?t('Mission home','الرئيسية'):activityInfo().find(a=>a.id===view)?.name;
 root.innerHTML=`${header()}<div class="workspace">${sidebar()}<main id="tobi-main" class="main-stage" tabindex="-1"><div class="stage-bar"><span class="breadcrumb">${t('TOBI / SAFE SPACE','توبي / مساحة آمنة')} <span>·</span> ${e(label||'')}</span><span class="status-pill"><i class="status-dot"></i>${canUseAI()?t('AI connected · ready to chat','AI متصل • جاهز للدردشة'):aiAccess.reason==='login_required'?t('AI available · sign in to use','AI متاح بعد تسجيل الدخول'):t('Notebook & games · ready','دفتر توبي والألعاب • جاهزين')}</span></div>${fileMode?`<div class="studio-notice warning local-file-notice"><strong>${t('You opened the file directly.','أنت فاتح الملف مباشرة.')}</strong> ${t('Free games work here. For accounts and AI, double-click Open Aman.cmd in the website folder, then open Tobi from the site.','الألعاب المجانية شغّالة هنا. للحسابات وAI، افتح Open Aman.cmd من فولدر الموقع بدبل كليك، وبعدها افتح توبي من الموقع.')} <a href="http://127.0.0.1:3000/${studio?'tobi-studio':'tobi'}.html">${t('Open the running site','افتح الموقع لو شغّال')} ↗</a></div>`:!connected?`<div class="studio-notice warning">${t('Server unavailable. Built-in play is ready; saving and AI are unavailable.','الخادم غير متاح. يمكنك اللعب بالإجابات المحفوظة، لكن الحفظ والذكاء الاصطناعي غير متاحين.')}</div>`:''}${studio?studioPage():({home:homePage,chat:chatPage,quest:questPage,words:wordsPage,riddles:riddlesPage}[view]||homePage)()}<p class="footnote">${t('Made for a kinder internet. Your original Tobi, now right here.','صُنع لإنترنت ألطف. توبي الأصلي أصبح هنا معك.')} <a href="privacy.html">${t('Privacy','الخصوصية')}</a></p></main></div>`;
 if(view==='chat'&&!studio){const log=document.querySelector('#chat-log');log.scrollTop=log.scrollHeight;}
}
function homePage(){
 const moods=[t('Your friendly digital sidekick','صاحبك في كل مغامرة'),t('Hey! Ready to explore together?','أهلًا بيك! جاهز نكتشف حاجة جديدة؟'),t('A little kindness goes a long way.','كلمة حلوة منك ممكن تفرّح حد.')];
 return `<section class="hero"><div class="hero-copy"><span class="eyebrow home-intro-kicker">${t('YOUR LITTLE CORNER OF CURIOSITY','مكانك الصغير للفضول والمغامرة')}</span><h1>${e(tr(config.greeting))}</h1><p>${t('A question, a puzzle, or a little adventure? I’m Tobi. Let’s make your time online a little kinder, together.','سؤال في بالك، لغز، ولا مغامرة صغيرة؟ أنا توبي، ويلا نخلّي وقتنا على النت ألطف شوية.')}</p><div class="button-row">${config.chatEnabled?`<button class="primary" data-view="chat">${t('Come say hello','تعال ندردش')} <span aria-hidden="true">↗</span></button>`:''}${config.questEnabled?`<button class="secondary" data-view="quest">${t('Try a little adventure','جرّب مغامرة صغيرة')}</button>`:''}</div></div><div class="hero-art"><div class="orb"></div><span class="spark-one" aria-hidden="true">✧</span><span class="spark-two" aria-hidden="true">✦</span><button class="tobi-greet" data-action="greet-tobi" aria-label="${t('Say hello to Tobi','سلّم على توبي')}">${portrait(companionMood===1)}</button><span class="hero-tag companion-mood" role="status"><b aria-hidden="true">●</b> ${moods[companionMood]}</span></div></section>
 ${config.chatEnabled?`<div class="home-quick-links"><span>${t('Start with a question:','نبدأ بسؤال؟')}</span>${[t('How can I help a friend?','كيف أساعد صديقي؟'),t('How do I protect my privacy?','كيف أحمي خصوصيتي؟')].map(q=>`<button class="quiet-button" data-chat-prompt="${e(q)}">${e(q)} <span aria-hidden="true">↗</span></button>`).join('')}</div>`:''}
 <div class="section-title"><h2>${t('What shall we explore?','هنكتشف إيه النهارده؟')}</h2><p>${t('Your pace. Your next adventure.','على راحتك. اختار مغامرتك.')}</p></div><section class="missions" aria-label="${t('Choose an activity','اختر نشاطًا')}">${activityInfo().filter(a=>a.enabled).map((a,i)=>`<button class="mission-card" data-view="${a.id}"><span class="mission-number" aria-hidden="true">0${i+1}</span><span class="card-icon" aria-hidden="true">${a.icon}</span><h3>${a.name}</h3><p>${a.description}</p><span class="card-bottom">${a.tag}<span aria-hidden="true">↗</span></span></button>`).join('')}</section><div class="home-footer"><span aria-hidden="true">✧</span><p>${t('Your best Safety Quest:','أفضل نتيجة لك في مهمة الأمان:')} <strong>${best}%</strong> ${user?t('· saved in your space','• محفوظة في مساحتك'):t('· log in to save across devices','• سجّل الدخول للحفظ عبر الأجهزة')}</p><progress max="100" value="${best}" aria-label="${t('Best Safety Quest score','أفضل نتيجة في مهمة الأمان')}"></progress></div>`;
}
const heading=(eyebrow,title,description)=>`<div class="view-heading"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>`;
const aiReason=reason=>({
 key_invalid:t('The AI key was rejected. The owner can replace it in Tobi Studio.','مفتاح AI غير صالح. مالك الموقع يقدر يغيّره من استوديو توبي.'),
 model_unavailable:t('This model is unavailable for the connected account. The owner can choose another model.','النموذج ده مش متاح للحساب المتصل. مالك الموقع يقدر يختار نموذج تاني.'),
 insufficient_quota:t('The OpenAI account needs API credit. Notebook answers and games still work.','رصيد الـAPI مش كافي. دفتر توبي والألعاب لسه شغّالين.'),
 provider_limit:t('The AI provider is busy or has reached its request limit. Try again later.','خدمة AI وصلت لحد الطلبات أو مشغولة. جرّب بعد شوية.'),
 request_timeout:t('The AI reply took too long. You can try again.','رد الـAI أخد وقت أطول من المتوقع. تقدر تحاول تاني.'),
 service_unavailable:t('The AI service could not reply. Tobi’s notebook and games are still ready.','خدمة AI ما قدرتش ترد دلوقتي. تقدر تستخدم دفتر توبي والألعاب.'),
 daily_limit:t('Today’s AI request limit is reached. Notebook answers and games are still ready.','وصلنا لحد طلبات AI النهارده. دفتر توبي والألعاب لسه جاهزين.'),
 login_required:t('Log in to use AI chat. Notebook answers are available to everyone.','سجّل الدخول عشان تستخدم محادثة AI. الردود المحفوظة متاحة للجميع.'),
 settings_changed:t('Connection settings changed. Refresh and test the saved connection again.','إعدادات الربط اتغيّرت. حدّث الحالة واختبر الاتصال المحفوظ تاني.'),
 visitor_limit:t('You have used today’s AI requests. Come back tomorrow; the notebook and games still work.','استخدمت طلبات AI المتاحة ليك النهارده. ارجع بكرة؛ دفتر توبي والألعاب لسه شغّالين.'),
 network_limit:t('Today’s AI limit for this internet connection is reached. The notebook and games still work.','وصلنا لحد طلبات AI من شبكة الإنترنت دي النهارده. دفتر توبي والألعاب لسه شغّالين.'),
 disabled:t('AI is currently off. The site owner can enable it in Tobi Studio. Notebook answers still work.','AI مقفول حاليًا. مالك الموقع يقدر يفعّله من استوديو توبي. دفتر توبي لسه شغّال.'),
 not_configured:t('AI is not connected yet. The site owner needs to add an API key in Tobi Studio.','AI لسه مش مربوط. مالك الموقع محتاج يضيف مفتاح API في استوديو توبي.'),
 busy:t('Tobi is handling several AI replies. Please try again in a moment.','توبي بيجهّز كذا رد AI دلوقتي. جرّب تاني كمان شوية.'),
 free_mode:t('AI is currently off. The notebook is still ready to help.','الـAI مقفول حاليًا. دفتر توبي لسه جاهز يساعدك.'),
 key_missing:t('Add an API key before testing the connection.','أضف مفتاح API قبل اختبار الاتصال.'),
 invalid_fields:t('Check the model name and API key. The key must be on one line.','راجع اسم النموذج ومفتاح API. المفتاح لازم يكون في سطر واحد.'),
 too_many_attempts:t('Please wait a minute before trying again.','استنى دقيقة قبل ما تحاول تاني.')
}[reason]||t('Could not complete the request. Please try again.','ما قدرناش نكمّل الطلب. حاول تاني.'));
function chatPage(){
 if(!messages.length)messages.push({role:'assistant',content:t('Hey, I’m Tobi! Ask me about staying safe online, or tell me what you’d like to learn.','أهلًا، أنا توبي! اسألني عن الأمان على النت، أو قولي حابب تتعلّم إيه.'),source:'notebook'});
 return `${heading(t('A LITTLE SUPPORT, RIGHT HERE','نتكلم، ونتعلّم سوا'),t('Let’s talk.','إيه اللي في بالك؟'),t('A question, a worry, or something you’re curious about. I’m listening.','سؤال، حاجة مضايقاك، أو موضوع نفسك تفهمه. أنا معاك.'))}<div class="chat-layout"><div class="chat-friend">${portrait()}<h3>Tobi / توبي</h3><p>${t('Learning with you, one question at a time.','سؤال منك، وحاجة جديدة نتعلّمها سوا.')}</p><button class="quiet-button" data-action="clear-chat">${t('New conversation','محادثة جديدة')}</button>${access.canEdit?`<a class="quiet-button" href="tobi-studio.html#ai">${t('Manage AI connection','إعدادات ربط AI')}</a>`:''}</div><section class="chat-card" aria-label="${t('Chat with Tobi','محادثة توبي')}"><div class="chat-top"><strong>${t('Your conversation','محادثتك مع توبي')}</strong><span class="muted">${pending?t('Preparing a reply…','بجهّز لك الرد…'):chatMode==='ai'?t('AI conversation','محادثة AI'):t('Ready for your question','جاهز لسؤالك')}</span></div>
 <div class="chat-toolbar"><div class="ai-mode-switch" role="group" aria-label="${t('Conversation mode','طريقة الرد')}"><button type="button" data-chat-mode="auto" aria-pressed="${chatMode==='auto'}" ${pending?'disabled':''}>${t('Auto','تلقائي')}</button><button type="button" data-chat-mode="ai" aria-pressed="${chatMode==='ai'}" ${pending?'disabled':''}>${t('AI chat','محادثة AI')} ✦</button></div><span>${chatMode==='ai'?t('AI answers every question','AI بيرد على كل سؤال'):t('Notebook first · AI when needed','دفتر توبي أولًا • AI عند الحاجة')}</span><button type="button" class="quiet-button chat-clear" data-action="clear-chat" aria-label="${t('Start a new conversation','ابدأ محادثة جديدة')}">↺</button></div>
 <div class="chat-log" id="chat-log" tabindex="0" role="log" aria-live="polite" aria-relevant="additions" aria-label="${t('Conversation','المحادثة')}">${messages.map(m=>`<div dir="auto" class="bubble ${m.role==='user'?'user':''}">${e(m.content)}<small>${m.role==='user'?t('You','أنت'):m.source==='openai'?t('Tobi · AI reply','توبي • رد AI'):t('Tobi’s notebook','دفتر توبي')}</small></div>`).join('')}${pending?`<div class="typing" role="status"><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>${t('Tobi is thinking…','توبي بيفكّر…')} <button class="quiet-button" data-action="stop-chat">${t('Stop','إيقاف')}</button></div>`:''}</div>${chatNotice?`<div class="chat-notice" role="status">${e(chatNotice)}${aiHelpLink()}</div>`:''}
 <div class="suggestions">${[t('What is cyberbullying?','ما هو التنمر الإلكتروني؟'),t('How do I make a strong password?','كيف أصنع كلمة مرور قوية؟'),t('How can I help a friend?','كيف أساعد صديقي؟')].map(q=>`<button data-prompt="${e(q)}" ${pending?'disabled':''}>${e(q)}</button>`).join('')}</div><form id="chat-form" class="chat-form"><label class="sr-only" for="chat-input">${t('Your message','رسالتك')}</label><textarea id="chat-input" name="message" dir="auto" maxlength="500" required placeholder="${t('What’s on your mind?','اكتب اللي في بالك…')}" aria-describedby="composer-hint" ${pending?'disabled':''}>${e(chatDraft)}</textarea><button class="primary" ${pending?'disabled':''}>${t('Send','إرسال')} <span aria-hidden="true">↗</span></button></form><div class="chat-composer-footer"><span id="composer-hint">${t('Enter to send · Shift + Enter for a new line','Enter للإرسال • Shift + Enter لسطر جديد')}</span><span class="chat-counter" dir="ltr" aria-hidden="true">${chatDraft.length} / 500</span></div>
 <p class="chat-note">${canUseAI()?(aiAccess.audience==='public'?t('AI is available here without an account or your own key. ','AI متاح هنا من غير حساب أو مفتاح منك. '):'')+t('AI may make mistakes. When used, your recent messages are sent to OpenAI. Avoid sharing private details.','ممكن AI يغلط. عند استخدامه، بنرسل آخر رسائلك لـOpenAI. بلاش تشارك بيانات خاصة.'):t('Notebook answers are free. Select AI chat to check availability. Conversations stay in this tab.','دفتر توبي مجاني. اضغط «محادثة AI» لمعرفة إتاحته. المحادثة بتفضل في الصفحة دي.')}${!canUseAI()?aiHelpLink():''}</p></section></div>`;
}
async function sendMessage(value){
 const message=value.trim();if(!message||message.length>500||pending)return;
 const history=messages.slice(-6).map(m=>({role:m.role,content:m.content.slice(0,1000)}));
 chatDraft='';messages.push({role:'user',content:message});chatNotice='';const known=chatMode==='auto'?findAnswer(message,config,lang):null;
 if(known){messages.push({role:'assistant',content:known,source:'notebook'});messages=messages.slice(-30);render();document.querySelector('#chat-input')?.focus();return;}

 pending=true;controller=new AbortController();const id=++requestId;render();
 try{
  await refreshAIState(controller.signal);
  if(id!==requestId)return;
  const refreshedAnswer=chatMode==='auto'?findAnswer(message,config,lang):null;
  if(refreshedAnswer){messages.push({role:'assistant',content:refreshedAnswer,source:'notebook'});return;}
  if(!canUseAI()){
   chatMode='auto';chatNotice=unavailableAI();
   messages.push({role:'assistant',content:t('I don’t have a notebook answer for that yet. Ask me about bullying, passwords, privacy, or helping a friend. My owner can teach me more answers in Tobi Studio!','السؤال ده مش موجود في دفتري لسه. جرّب تسألني عن التنمّر، كلمة المرور، الخصوصية، أو مساعدة صاحبك. ومالك الموقع يقدر يعلّمني ردود جديدة أو يربطني بـAI!'),source:'notebook'});
   return;
  }
  const result=await api('/api/tobi/chat',{method:'POST',signal:controller.signal,body:JSON.stringify({message,language:lang,history,mode:chatMode})});
  if(id!==requestId)return;
  messages.push({role:'assistant',content:result.answer,source:result.source});
  chatNotice=result.reason?aiReason(result.reason):'';
 }catch(error){if(id!==requestId)return;chatNotice=errorText(error);}
 finally{if(id===requestId){pending=false;controller=null;messages=messages.slice(-30);render();document.querySelector('#chat-input')?.focus();}}
}
function cancelChat(){requestId++;controller?.abort();controller=null;pending=false;}
function questPage(){
 if(quiz.done)return `${heading(t('YOUR LITTLE VICTORY','انتصارك الصغير'),t('Look at you, learning!','انظر إليك وأنت تتعلم!'),t('Every choice is a chance to make things kinder.','كل اختيار فرصة لجعل الأمور ألطف.'))}<section class="activity-panel result">${portrait(true)}<h2>${quiz.correct/config.questions.length>=.8?t('Digital defender','حامي العالم الرقمي'):t('Kindness explorer','مستكشف اللطف')}</h2><div class="score">${quiz.correct}<small> / ${config.questions.length}</small></div><p>${t('Take one of these ideas into your day. You can make a difference.','خذ إحدى هذه الأفكار معك اليوم. يمكنك أن تصنع فرقاً.')}</p><p role="status">${e(quiz.save)}</p><div class="button-row"><button class="primary" data-action="restart-quest">${t('Play again','العب مجدداً')} ↻</button><button class="secondary" data-view="home">${t('Back home','العودة للرئيسية')}</button></div></section>`;
 const q=config.questions[quiz.index],answered=quiz.selected!==null;
 return `${heading(t('PRACTISE YOUR DIGITAL SUPERPOWERS','تدرّب على قدراتك الرقمية'),t('Safety Quest','مهمة الأمان'),t('No lost lives. Just small choices that matter.','لا خسارة للأرواح. فقط اختيارات صغيرة ومهمة.'))}<section class="activity-panel quest-question"><div class="quiz-top"><span>${t('Mission','المهمة')} ${quiz.index+1} / ${config.questions.length}</span><button class="quiet-button" data-action="sound" aria-pressed="${sound}">${sound?t('Sound on ♪','الصوت يعمل ♪'):t('Sound off','الصوت مغلق')}</button></div><progress max="${config.questions.length}" value="${quiz.index+(answered?1:0)}" aria-label="${t('Quest progress','تقدم المهمة')}"></progress><h2>${e(tr(q.q))}</h2><div class="options">${q.options.map((o,i)=>`<button class="answer-option ${answered&&i===q.correct?'correct':''} ${answered&&i===quiz.selected&&i!==q.correct?'incorrect':''}" data-choice="${i}" ${answered?'disabled':''}><b>${['A','B','C'][i]}</b>${e(tr(o))}</button>`).join('')}</div>${answered?`<div class="feedback" role="status"><strong>${quiz.selected===q.correct?t('Good thinking!','تفكير رائع!'):t('A chance to learn.','فرصة للتعلم.')}</strong><p>${e(tr(q.why))}</p></div><div class="quest-actions"><span class="muted">${quiz.correct} ${t('kind choices so far','اختيارات لطيفة حتى الآن')}</span><button class="primary" data-action="next-question">${quiz.index===config.questions.length-1?t('See my result','شاهد نتيجتي'):t('Next mission','المهمة التالية')} →</button></div>`:`<p class="footnote">${t('Pick the choice that feels right.','اختر التصرف الذي تراه مناسباً.')}</p>`}</section>`;
}
async function finishQuest(){
 const round=quiz,score=Math.round(100*quiz.correct/config.questions.length);best=Math.max(best,score);
 if(!user){try{localStorage.setItem('tobi-guest-best',String(best));}catch{}quiz.save=t('Best saved on this browser. Log in to save to your account.','حُفظت أفضل نتيجة في هذا المتصفح. سجّل الدخول للحفظ في حسابك.');return;}
 quiz.save=t('Saving your progress…','جارٍ حفظ تقدمك…');
 try{const saved=await api('/api/tobi/progress',{method:'PUT',body:JSON.stringify({score})});best=saved.best;round.save=t('Saved to your account. Nice work!','حُفظت في حسابك. أحسنت!');}catch{round.save=t('Couldn’t save to your account. Your result is still here.','تعذر الحفظ في حسابك. نتيجتك ما زالت هنا.');}
 if(view==='quest'&&quiz===round)render();
}
function wordsPage(){return `${heading(t('WORDS HAVE POSSIBILITIES','الكلمات مليئة بالاحتمالات'),t('Find another way to say it.','اكتشف طريقة أخرى للتعبير.'),t('Explore synonyms and opposites in our English word bank.','اكتشف المرادفات والأضداد في بنك الكلمات الإنجليزية.'))}<section class="activity-panel"><h2>${t('Pick a word. Follow your curiosity.','اختر كلمة واتبع فضولك.')}</h2><form id="word-form" class="activity-form"><label for="word-input">${t('English word','كلمة إنجليزية')}<input id="word-input" maxlength="40" required placeholder="Try kind, brave, happy…" dir="ltr"></label><button class="primary">${t('Explore','اكتشف')} ↗</button></form><div class="word-chips">${words.map(w=>`<button data-word="${w[0]}" lang="en">${w[0]}</button>`).join('')}</div>${wordResult?typeof wordResult==='string'?`<p class="studio-notice warning" role="status">${e(wordResult)}</p>`:`<div class="word-result" role="status"><div><h3>${t('SYNONYMS · SIMILAR MEANING','مرادفات • معنى مشابه')}</h3><p dir="ltr" lang="en">${e(wordResult[1])}</p></div><div><h3>${t('ANTONYMS · OPPOSITE MEANING','أضداد • معنى معاكس')}</h3><p dir="ltr" lang="en">${e(wordResult[2])}</p></div></div>`:''}</section>`;}
function riddlesPage(){const r=riddles[riddleIndex];return `${heading(t('LIGHTS. CAMERA. CURIOSITY.','أضواء وكاميرا وفضول'),t('Guess the movie.','خمّن الفيلم.'),t('Three little clues. One big story.','ثلاثة أدلة صغيرة وقصة كبيرة.'))}<section class="activity-panel"><div class="quiz-top"><strong>${t('Movie riddle','لغز الفيلم')} ${riddleIndex+1} / ${riddles.length}</strong><span>${t('Play with a friend','العب مع صديق')}</span></div><div class="riddle-emoji" role="img" aria-label="${t('Emoji movie clues','أدلة الفيلم بالرموز')}: ${r.clue}" dir="ltr">${r.clue}</div><form id="riddle-form" class="activity-form"><label for="riddle-input">${t('Your guess','تخمينك')}<input id="riddle-input" required maxlength="80" autocomplete="off" placeholder="${t('Name that movie…','ما اسم الفيلم؟')}"></label><button class="primary">${t('Check my guess','تحقق من تخميني')}</button></form><p class="riddle-reveal" role="status">${e(riddleResult)}</p><div class="button-row"><button class="secondary" data-action="reveal-riddle">${t('Reveal the answer','اكشف الإجابة')}</button><button class="secondary" data-action="next-riddle">${t('Next riddle','اللغز التالي')} →</button></div></section>`;}
function studioPage(){
 if(!connected)return `<section class="empty-state"><h1>${t('Start the Aman server first.','شغّل خادم أمان أولاً.')}</h1><p>${t('Tobi Studio needs the server to save your changes.','يحتاج استوديو توبي إلى الخادم لحفظ التغييرات.')}</p></section>`;
 if(!user)return `<section class="activity-panel studio-access"><span class="eyebrow">TOBI STUDIO</span><h1>${t('Your game. Your imagination.','لعبتك وخيالك.')}</h1><p>${t('Log in to manage Tobi’s answers, missions and settings. Only the site owner can make changes.','سجّل الدخول لإدارة إجابات توبي ومهامه وإعداداته. المالك فقط يستطيع إجراء التغييرات.')}</p><a class="primary" href="login.html?next=tobi-studio.html">${t('Log in to continue','سجّل الدخول للمتابعة')}</a></section>`;
 if(!access.canEdit)return `<section class="activity-panel studio-access"><span class="eyebrow">TOBI STUDIO</span><h1>${access.ownerConfigured?t('This is the owner’s studio.','هذا استوديو مالك الموقع.'):t('Make this your studio.','اجعل هذا استوديوك.')}</h1><p>${access.ownerConfigured?t('Sign in with the owner account to edit this game. Everyone can still play for free.','سجّل الدخول بحساب المالك لتعديل اللعبة. يستطيع الجميع اللعب مجاناً.'):t('One-time setup: copy the code from .data/tobi-owner-code.txt on the computer running this website. This connects the studio to your signed-in account.','إعداد لمرة واحدة: انسخ الرمز من ملف .data/tobi-owner-code.txt على الجهاز الذي يشغّل الموقع لربط الاستوديو بحسابك.')}</p>${!access.ownerConfigured?`<form id="claim-form"><label for="owner-code">${t('Owner setup code','رمز إعداد المالك')}</label><input id="owner-code" type="password" maxlength="100" required autocomplete="off"><button class="primary">${t('Connect my account','اربط حسابي')}</button></form>`:`<a class="secondary" href="tobi.html">${t('Back to Tobi','العودة إلى توبي')}</a>`}<p class="status-message error" role="status">${e(studioMessage)}</p></section>`;
 if(!draft)draft=structuredClone(config);
 return `${heading(t('YOU’RE IN THE DIRECTOR’S CHAIR','أنت من يتحكم في اللعبة'),t('Tobi Studio','استوديو توبي'),t('Teach a new answer. Shape a mission. Make this little world yours.','علّم إجابة جديدة وصمّم مهمة واجعل هذا العالم الصغير ملكك.'))}<div class="studio-toolbar"><div class="studio-tabs" role="tablist" aria-label="${t('Studio sections','أقسام الاستوديو')}">${[['settings',t('Game settings','إعدادات اللعبة')],['answers',t('Tobi’s notebook','دفتر توبي')],['questions',t('Safety Quest','مهمة الأمان')],['ai',t('AI connection','ربط AI')]].map(([id,label])=>`<button class="quiet-button" role="tab" aria-selected="${editorTab===id}" data-tab="${id}">${label}</button>`).join('')}</div><button class="primary" data-action="save-studio" ${editorTab==='ai'?'hidden':''}>${t('Save changes','احفظ التغييرات')} ✓</button></div><p class="status-message" id="studio-status" role="status">${e(studioMessage)}</p><section class="activity-panel editor-body">${editorTab==='ai'?connectionEditor():editorTab==='settings'?settingsEditor():contentEditor()}</section><p class="footnote">${t('Changes appear when players reopen or refresh Tobi. Conversations are not collected in this studio.','تظهر التغييرات عند إعادة فتح اللعبة أو تحديثها. لا يجمع الاستوديو محادثات اللاعبين.')} <a href="tobi.html" target="_blank" rel="noopener">${t('Open game preview ↗','افتح معاينة اللعبة ↗')}</a></p>`;
}
const editField=(label,path,value,max=180,area=false)=>`<label class="field">${label}${area?`<textarea data-edit="${path}" maxlength="${max}" required>${e(value)}</textarea>`:`<input data-edit="${path}" value="${e(value)}" maxlength="${max}" required>`}</label>`;
function settingsEditor(){return `<div class="settings-grid">${editField('Welcome message · English','greeting.en',draft.greeting.en,150)}${editField('رسالة الترحيب · العربية','greeting.ar',draft.greeting.ar,150)}${[['animations',t('Tobi animations','حركات توبي')],['chatEnabled',t('Talk to Tobi','تحدث مع توبي')],['questEnabled',t('Safety Quest','مهمة الأمان')],['wordsEnabled',t('Word Lab','مختبر الكلمات')],['riddlesEnabled',t('Movie Riddles','ألغاز الأفلام')]].map(([key,label])=>`<label class="toggle-row">${label}<input type="checkbox" data-setting="${key}" ${draft[key]?'checked':''}></label>`).join('')}<div class="field full"><div class="studio-notice">${t('Free mode is always available. Notebook answers and games need no API key or subscription.','الوضع المجاني متاح دائماً. الإجابات المحفوظة والألعاب لا تحتاج إلى مفتاح API أو اشتراك.')}</div><label class="toggle-row"><span>${t('Enable OpenAI for unfamiliar questions','فعّل OpenAI للأسئلة غير المعروفة')}<small>${t('AI uses your API credit. Choose who can use it and daily request limits in the AI connection tab.','AI بيستخدم رصيدك. اختار مين يستخدمه وحدود الطلبات اليومية من تبويب ربط AI.')}</small></span><input type="checkbox" data-setting="openAIEnabled" ${draft.openAIEnabled?'checked':''} ${!access.keyConfigured?'disabled':''}></label><p class="footnote">${access.keyConfigured?t('A server key is configured. It is never sent to players. Model: ','يوجد مفتاح على الخادم لا يُرسل للاعبين. النموذج: ')+e(access.model):t('Add your API key from the AI connection tab. No server restart needed.','أضف مفتاح API من تبويب ربط AI، من غير ما تعيد تشغيل السيرفر.')}</p></div></div>`;}
function syncConnection(status){
 if(!status)return;
 connection=status;
 access={...access,keyConfigured:status.keyConfigured,model:status.model,dailyLimit:status.dailyLimit,connection:status};
 config.openAIEnabled=!!status.enabled;
 if(draft)draft.openAIEnabled=!!status.enabled;
 aiAvailable=connected&&!!status.keyConfigured&&!!status.enabled;
 const audience=status.policy?.audience||'members';
 const reason=!status.keyConfigured?'not_configured':!status.enabled||!config.chatEnabled?'disabled':audience==='members'&&!user?'login_required':null;
 aiAccess={audience,ready:!reason,reason};
}
function connectionEditor(){
 const status=connection||{keyConfigured:!!access.keyConfigured,model:access.model||'gpt-5.6-luna',enabled:config.openAIEnabled,dailyLimit:access.dailyLimit||50,userDailyLimit:10,usage:{site:0,user:0},lastTest:null};
 const policy=status.policy||{audience:'members',siteDailyLimit:status.dailyLimit,visitorDailyLimit:status.userDailyLimit,networkDailyLimit:100};
 const disabled=connectionBusy?'disabled':'';
 const state=!status.keyConfigured?'empty':status.lastTest?.ok===false?'error':status.enabled?'active':'saved';
 const label=!status.keyConfigured?t('Not connected yet','لسه مفيش ربط'):status.enabled?t('AI is enabled','AI مفعّل'):t('Key saved · AI is off','المفتاح محفوظ • AI مقفول');
 return `<div class="connection-panel" aria-busy="${connectionBusy}"><div class="connection-hero"><div><span class="eyebrow">${t('TOBI + OPENAI','توبي + OpenAI')}</span><h2>${t('A conversation that goes further.','خلّي الحوار يكمل مع توبي.')}</h2><p>${t('Connect your own OpenAI key here. Add it once, test it, then choose when to turn AI on.','اربط مفتاح OpenAI بتاعك من هنا. احفظه، اختبر الاتصال، وبعدها فعّل AI وقت ما تحب.')}</p></div><span class="connection-badge" data-state="${state}">${label}</span></div>
 <ol class="connection-steps"><li class="connection-step"><b>01</b><span>${t('Save your key','احفظ المفتاح')}</span></li><li class="connection-step"><b>02</b><span>${t('Test the connection','اختبر الاتصال')}</span></li><li class="connection-step"><b>03</b><span>${t('Enable AI chat','فعّل محادثة AI')}</span></li></ol>
 <p class="connection-feedback ${connectionError?'error':''}" id="connection-feedback" role="status" aria-live="polite">${e(connectionMessage)}</p>
 <div class="connection-grid"><form id="connection-form" class="connection-form" autocomplete="off"><h3>${t('Your connection','إعدادات الربط')}</h3><label class="field" for="api-key">${t('OpenAI API key','مفتاح OpenAI API')}<input id="api-key" name="apiKey" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="none" maxlength="512" dir="ltr" placeholder="${status.keyConfigured?t('Leave blank to keep the saved key','سيبه فاضي للاحتفاظ بالمفتاح الحالي'):'sk-…'}" aria-describedby="key-help" ${disabled}></label><p id="key-help" class="connection-model-hint">${status.keyConfigured?t('A key is already saved on the server. Paste a new one only to replace it.','فيه مفتاح محفوظ على السيرفر. اكتب مفتاح جديد بس لو عايز تستبدله.'):t('Create a fresh key in your OpenAI account. It stays on this server and is never returned to players.','اعمل مفتاح جديد من حساب OpenAI. هيتحفظ على السيرفر ومش بيتبعت للاعبين.')} <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">${t('Get an API key ↗','افتح صفحة المفاتيح ↗')}</a></p>
 <label class="field" for="ai-model">${t('Model name','اسم النموذج')}<input id="ai-model" name="model" dir="ltr" value="${e(status.model)}" required maxlength="100" pattern="[a-zA-Z0-9._:-]+" autocomplete="off" spellcheck="false" aria-describedby="model-help" ${disabled}></label><p id="model-help" class="connection-model-hint">${t('Recommended: gpt-5.6-luna. You can enter another Responses-compatible model available to your account.','المقترح: gpt-5.6-luna. تقدر تكتب نموذج تاني متاح لحسابك ويدعم Responses.')}</p><button class="primary" type="submit" ${disabled}>${connectionBusy?t('Working…','جاري التنفيذ…'):t('Save connection','احفظ الربط')}</button></form>
 <div class="connection-summary"><h3>${t('Ready when you are','شغّله وقت ما تكون جاهز')}</h3><p class="connection-status">${status.keyConfigured?t('✓ A server-side key is configured.','✓ فيه مفتاح محفوظ على السيرفر.'):t('Add a key to unlock the connection test.','أضف المفتاح عشان تقدر تختبر الاتصال.')}</p><div class="connection-actions"><button type="button" class="secondary" data-action="test-connection" ${!status.keyConfigured||connectionBusy?'disabled':''}>${t('Test connection','اختبر الاتصال')}</button><button type="button" class="primary" data-action="toggle-ai" ${!status.keyConfigured||connectionBusy?'disabled':''}>${status.enabled?t('Turn AI off','أوقف AI'):t('Enable AI for Tobi','فعّل AI لتوبي')}</button></div>
 ${status.lastTest?`<div class="connection-test-result ${status.lastTest.ok?'':'error'}" role="status"><strong>${status.lastTest.ok?t('Connection test passed','اختبار الاتصال نجح'):t('Connection needs attention','الاتصال محتاج مراجعة')}</strong><p>${status.lastTest.ok?t('Your key and model returned a reply.','المفتاح والنموذج رجّعوا رد بنجاح.'):aiReason(status.lastTest.reason)}</p></div>`:''}
 <div class="ai-usage"><span>${t('AI requests today · UTC','طلبات AI النهارده • UTC')}</span><strong dir="ltr">${Number(status.usage?.site)||0} / ${Number(status.dailyLimit)||50}</strong><small>${t('Your account: ','حسابك: ')}${Number(status.usage?.user)||0} / ${Number(status.userDailyLimit)||10}</small></div><div class="connection-actions"><button type="button" class="quiet-button" data-action="refresh-connection" ${disabled}>${t('Refresh status','حدّث الحالة')}</button><button type="button" class="quiet-button danger" data-action="remove-connection" ${!status.keyConfigured||connectionBusy?'disabled':''}>${t('Disconnect AI','افصل ربط AI')}</button></div></div></div>

 <form id="ai-policy-form" class="ai-policy-form"><div class="policy-intro"><span class="eyebrow">${t('YOUR KEY, YOUR CHOICE','مفتاحك، وتحكّمك')}</span><h3>${t('Who can talk to Tobi with AI?','مين يقدر يدردش مع توبي بالـAI؟')}</h3><p>${t('Visitors use your key without seeing it. AI usage is charged to your API balance.','الزوار بيستخدموا مفتاحك من غير ما يشوفوه، والاستهلاك على رصيدك.')}</p></div>
 <label class="field" for="ai-audience">${t('AI access','إتاحة AI')}<select id="ai-audience" name="audience" ${disabled}><option value="public" ${policy.audience==='public'?'selected':''}>${t('Everyone · no login needed','كل الزوار • من غير تسجيل دخول')}</option><option value="members" ${policy.audience==='members'?'selected':''}>${t('Signed-in members only','الأعضاء المسجّلين بس')}</option></select></label>
 <div class="policy-limits">${[['siteDailyLimit',t('Whole website / day','الموقع كله / يوم'),10000],['visitorDailyLimit',t('Each visitor / day','كل زائر / يوم'),1000],['networkDailyLimit',t('Each internet connection / day','كل شبكة إنترنت / يوم'),10000]].map(([name,label,max])=>`<label class="field" for="policy-${name}">${label}<input id="policy-${name}" name="${name}" type="number" min="1" max="${max}" step="1" value="${Number(policy[name])}" required aria-describedby="policy-help" ${disabled}></label>`).join('')}</div>
 <p id="policy-help" class="connection-model-hint">${t('Limits reset at midnight UTC. The first limit reached pauses AI. People on shared Wi-Fi share the network limit. Tests and failed AI calls count too.','الحدود بتتجدد منتصف الليل بتوقيت UTC. أول حد نوصل له بيوقف AI. الناس على نفس الواي فاي بيتشاركوا حد الشبكة. اختبارات الاتصال وطلبات AI الفاشلة بتتحسب كمان.')}</p>
 <div class="connection-actions"><button class="primary" type="submit" ${disabled}>${t('Save access settings','احفظ إعدادات الإتاحة')}</button><span class="connection-model-hint">${t('Saving these settings makes no AI request.','حفظ الإعدادات دي مش بيستخدم رصيد AI.')}</span></div></form>
 <p class="connection-warning">${t('Saving a key makes no AI request. Testing and AI chats use your API credit. Request limits are not a currency spending cap; also manage your budget in your OpenAI account.','حفظ المفتاح مش بيبعت طلب AI. اختبار الاتصال ومحادثات AI بيستخدموا رصيدك. حدود الطلبات مش حد للمبلغ المصروف؛ تابع ميزانيتك كمان من حساب OpenAI.')}</p></div>`;
}
async function saveAIPolicy(form){
 if(connectionBusy||!access.canEdit)return;
 const policy={audience:form.elements.audience.value};
 for(const name of ['siteDailyLimit','visitorDailyLimit','networkDailyLimit'])policy[name]=Number(form.elements[name].value);
 connectionBusy=true;connectionError=false;connectionMessage=t('Saving access settings…','بنحفظ إعدادات الإتاحة…');render();
 try{
  const result=await api('/api/tobi/policy',{method:'PUT',body:JSON.stringify(policy)});
  syncConnection(result.connection);connectionMessage=t('Access settings saved.','إعدادات الإتاحة اتحفظت.');
 }catch(error){connectionError=true;connectionMessage=error.message==='invalid_fields'?t('Choose who can use AI and enter whole numbers within the allowed limits.','اختار مين يستخدم AI واكتب أعداد صحيحة جوّه الحدود المسموحة.'):errorText(error);}
 finally{connectionBusy=false;render();}
}
async function saveConnection(form){
 if(connectionBusy||!access.canEdit)return;
 const key=form.elements.apiKey.value.trim(),model=form.elements.model.value.trim();
 if(!key&&!access.keyConfigured){connectionMessage=aiReason('key_missing');connectionError=true;render();return;}
 const payload={model,...(key?{apiKey:key}:{})};
 form.elements.apiKey.value='';
 connectionBusy=true;connectionMessage=t('Saving your connection…','بنحفظ الربط…');connectionError=false;render();
 try{
  const result=await api('/api/tobi/connection',{method:'PUT',body:JSON.stringify(payload)});
  syncConnection(result.connection);
  connectionMessage=t('Saved. You can now test the connection. No server restart needed.','اتحفظ. تقدر تختبر الاتصال دلوقتي، من غير إعادة تشغيل السيرفر.');
 }catch(error){connectionError=true;connectionMessage=['invalid_fields','key_missing','key_invalid'].includes(error.message)?aiReason(error.message):errorText(error);}
 finally{connectionBusy=false;render();}
}
async function performConnection(action){
 if(connectionBusy||!access.canEdit)return;
 connectionBusy=true;connectionError=false;connectionMessage=action==='test'?t('Testing your saved key and model…','بنختبر المفتاح والنموذج المحفوظين…'):t('Updating…','بنحدّث الإعدادات…');render();
 try{
  if(action==='test'){
   const result=await api('/api/tobi/connection/test',{method:'POST',body:'{}'});
   syncConnection(result.connection);connectionError=!result.ok;
   connectionMessage=result.ok?t('Connected! Tobi received an AI reply.','الاتصال نجح! توبي استقبل رد من AI.'):aiReason(result.reason);
  }else if(action==='remove'){
   const result=await api('/api/tobi/connection/remove',{method:'POST',body:'{}'});
   config=result.config;revision=result.revision;syncConnection(result.connection);
   connectionMessage=t('Disconnected. Notebook answers and games still work.','تم فصل الربط. الردود المحفوظة والألعاب لسه شغّالين.');
  }else if(action==='toggle'){
   const saved=await api('/api/tobi/admin',{method:'PUT',body:JSON.stringify({revision,config:{...config,openAIEnabled:!config.openAIEnabled}})});
   config=saved.config;revision=saved.revision;syncConnection(await api('/api/tobi/connection'));
   connectionMessage=config.openAIEnabled?t('AI is on. Open Tobi to start a conversation.','AI اتفعّل. افتح توبي وابدأ المحادثة.'):t('AI is off. Free activities remain available.','AI اتقفل. الأنشطة المجانية لسه متاحة.');
  }else{
   syncConnection(await api('/api/tobi/connection'));connectionMessage=t('Status updated.','الحالة اتحدّثت.');
  }
 }catch(error){connectionError=true;connectionMessage=['key_missing','daily_limit','too_many_attempts'].includes(error.message)?aiReason(error.message):errorText(error);}
 finally{connectionBusy=false;render();}
}
function contentEditor(){
 const answers=editorTab==='answers',rows=answers?draft.answers:draft.questions,index=answers?selectedAnswer:selectedQuestion,row=rows[index],prefix=(answers?'answers':'questions')+'.'+index;
 return `<div class="editor-picker"><label class="sr-only" for="editor-select">${t('Choose an entry','اختر عنصراً')}</label><select id="editor-select">${rows.map((r,i)=>`<option value="${i}" ${i===index?'selected':''}>${i+1}. ${e(tr(r.q))}</option>`).join('')}</select><button class="secondary" data-action="add-entry" ${rows.length>=(answers?40:10)?'disabled':''}>+ ${t('Add new','أضف جديداً')}</button><button class="secondary danger" data-action="remove-entry" ${rows.length<2?'disabled':''}>${t('Remove','حذف')}</button></div><div class="settings-grid">${editField('Question · English',prefix+'.q.en',row.q.en,answers?180:220)}${editField('السؤال · العربية',prefix+'.q.ar',row.q.ar,answers?180:220)}${answers?`${editField('Answer · English',prefix+'.answer.en',row.answer.en,1200,true)}${editField('الإجابة · العربية',prefix+'.answer.ar',row.answer.ar,1200,true)}<label class="field full">${t('Matching words or phrases (comma separated; up to 12)','كلمات أو عبارات المطابقة (مفصولة بفواصل، حتى ١٢)')}<input data-keywords value="${e(row.keywords.join(', '))}" maxlength="720"></label>`:`${row.options.map((o,i)=>editField(['A','B','C'][i]+' · English',prefix+'.options.'+i+'.en',o.en,160)+editField(['A','B','C'][i]+' · العربية',prefix+'.options.'+i+'.ar',o.ar,160)).join('')}<label class="field full">${t('Correct choice','الإجابة الصحيحة')}<select data-correct>${['A','B','C'].map((label,i)=>`<option value="${i}" ${row.correct===i?'selected':''}>${label}</option>`).join('')}</select></label>${editField('Explanation · English',prefix+'.why.en',row.why.en,500,true)}${editField('الشرح · العربية',prefix+'.why.ar',row.why.ar,500,true)}`}</div>`;
}
let audioContext;
function chime(){if(!sound)return;try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();const now=audioContext.currentTime;[523.25,659.25,783.99].forEach((frequency,i)=>{const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.frequency.value=frequency;gain.gain.setValueAtTime(.045,now+i*.09);gain.gain.exponentialRampToValueAtTime(.001,now+i*.09+.23);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now+i*.09);osc.stop(now+i*.09+.25);});}catch{}}
function navigate(next){if(studio){location.href='tobi.html'+(next==='home'?'':'#'+next);return;}if(next!=='home'&&!activityInfo().some(a=>a.id===next&&a.enabled))return;cancelChat();view=next;render();document.querySelector('#tobi-main')?.focus({preventScroll:true});}
root.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.view)return navigate(button.dataset.view);
 if(button.dataset.chatPrompt){navigate('chat');return sendMessage(button.dataset.chatPrompt);}
 if(button.dataset.chatMode){
  if(pending)return;
  if(button.dataset.chatMode==='auto'){requestId++;chatMode='auto';chatNotice='';render();return;}
  const id=++requestId;
  chatNotice=t('Checking AI availability…','بنتأكد إن AI متاح…');render();
  await refreshAIState();
  if(id!==requestId||pending||studio||view!=='chat')return;
  chatMode=canUseAI()?'ai':'auto';chatNotice=canUseAI()?'':unavailableAI();render();
  document.querySelector(canUseAI()?'#chat-input':'[data-chat-mode=ai]')?.focus({preventScroll:true});
  return;
 }
 if(button.dataset.prompt)return sendMessage(button.dataset.prompt);
 if(button.dataset.word){wordResult=words.find(w=>w[0]===button.dataset.word);render();return;}
 if(button.dataset.choice!==undefined){if(quiz.selected!==null||quiz.done)return;quiz.selected=Number(button.dataset.choice);if(quiz.selected===config.questions[quiz.index].correct){quiz.correct++;chime();}render();document.querySelector('[data-action=next-question]')?.focus();return;}
 if(button.dataset.tab){editorTab=button.dataset.tab;studioMessage='';render();return;}
 switch(button.dataset.action){
  case 'language':cancelChat();lang=lang==='en'?'ar':'en';try{localStorage.setItem('aman-language',lang);}catch{}render();break;
  case 'clear-chat':cancelChat();messages=[];chatDraft='';chatNotice='';render();break;
  case 'greet-tobi':companionMood=(companionMood+1)%3;chime();render();break;
  case 'test-connection':return performConnection('test');
  case 'remove-connection':return performConnection('remove');
  case 'refresh-connection':return performConnection('refresh');
  case 'toggle-ai':return performConnection('toggle');
  case 'stop-chat':cancelChat();chatNotice=t('Stopped. You can ask another question.','تم الإيقاف. يمكنك طرح سؤال آخر.');render();break;
  case 'sound':sound=!sound;chime();render();break;
  case 'restart-quest':quiz={index:0,selected:null,correct:0,done:false,save:''};render();break;
  case 'next-question':if(quiz.selected===null||quiz.done)return;quiz.index++;quiz.selected=null;if(quiz.index>=config.questions.length){quiz.done=true;finishQuest();}render();document.querySelector('.quest-question h2')?.scrollIntoView({block:'nearest'});break;
  case 'next-riddle':riddleIndex=(riddleIndex+1)%riddles.length;riddleResult='';render();break;
  case 'reveal-riddle':riddleResult=lang==='ar'?riddles[riddleIndex].ar:riddles[riddleIndex].title;render();break;
  case 'add-entry':{if(!access.canEdit)return;dirty=true;const id=crypto.randomUUID();if(editorTab==='answers'){draft.answers.push({id,q:{en:'New question',ar:'سؤال جديد'},answer:{en:'Your helpful answer.',ar:'إجابتك المفيدة.'},keywords:[]});selectedAnswer=draft.answers.length-1;}else{draft.questions.push({id,q:{en:'Your new mission?',ar:'مهمتك الجديدة؟'},options:[{en:'Choice A',ar:'الاختيار أ'},{en:'Choice B',ar:'الاختيار ب'},{en:'Choice C',ar:'الاختيار ج'}],correct:0,why:{en:'Why this choice helps.',ar:'لماذا يساعد هذا الاختيار.'}});selectedQuestion=draft.questions.length-1;}render();break;}
  case 'remove-entry':{if(!access.canEdit)return;const rows=editorTab==='answers'?draft.answers:draft.questions;if(rows.length<2)return;dirty=true;rows.splice(editorTab==='answers'?selectedAnswer:selectedQuestion,1);selectedAnswer=0;selectedQuestion=0;render();break;}
  case 'save-studio':{if(!access.canEdit)return;button.disabled=true;try{const saved=await api('/api/tobi/admin',{method:'PUT',body:JSON.stringify({revision,config:draft})});config=saved.config;revision=saved.revision;aiAvailable=access.keyConfigured&&config.openAIEnabled;if(connection)syncConnection({...connection,enabled:config.openAIEnabled});dirty=false;studioMessage=t('Saved! Your game is ready for its next visitor.','حُفظت! لعبتك جاهزة للزائر التالي.');render();}catch(error){studioMessage=errorText(error);const status=document.querySelector('#studio-status');status.textContent=studioMessage;status.classList.add('error');button.disabled=false;}break;}
 }
});
root.addEventListener('submit',async event=>{
 event.preventDefault();const form=event.target;
 if(form.id==='chat-form')return sendMessage(form.elements.message.value);
 if(form.id==='connection-form')return saveConnection(form);
 if(form.id==='ai-policy-form')return saveAIPolicy(form);
 if(form.id==='word-form'){wordResult=words.find(w=>w[0]===normalize(document.querySelector('#word-input').value))||t('That word isn’t in my notebook yet. Pick one of the word chips to explore.','هذه الكلمة ليست في دفتري بعد. اختر كلمة من الأزرار لاكتشافها.');render();return;}
 if(form.id==='riddle-form'){const guess=normalize(document.querySelector('#riddle-input').value),r=riddles[riddleIndex];const right=[r.title,r.ar].some(name=>normalize(name)===guess);riddleResult=right?t('You got it! '+r.title,'أحسنت! '+r.ar):t('Not quite. Look at the clues and try again!','ليست الإجابة تماماً. انظر للأدلة وحاول مجدداً!');if(right)chime();render();return;}
 if(form.id==='claim-form'){const button=form.querySelector('button');button.disabled=true;try{await api('/api/tobi/claim',{method:'POST',body:JSON.stringify({code:document.querySelector('#owner-code').value})});access=await api('/api/tobi/access');connection=access.connection||null;studioMessage=t('Welcome to your studio!','مرحباً في استوديوك!');render();}catch(error){studioMessage=errorText(error);render();}}
});
root.addEventListener('keydown',event=>{if(event.target.id==='chat-input'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendMessage(event.target.value);}});
root.addEventListener('input',event=>{
 if(event.target.id==='chat-input'){chatDraft=event.target.value;const count=root.querySelector('.chat-counter');if(count)count.textContent=chatDraft.length+' / 500';}
 if(!access.canEdit||!draft)return;const el=event.target;
 if(el.dataset.edit){const parts=el.dataset.edit.split('.');let obj=draft;for(const part of parts.slice(0,-1))obj=obj[part];obj[parts.at(-1)]=el.value;dirty=true;}
 if(el.hasAttribute('data-keywords')){draft.answers[selectedAnswer].keywords=el.value.split(/[,،]/).map(x=>x.trim()).filter(Boolean);dirty=true;}
});
root.addEventListener('change',event=>{
 if(!access.canEdit||!draft)return;const el=event.target;
 if(el.dataset.setting){draft[el.dataset.setting]=el.checked;dirty=true;}
 if(el.hasAttribute('data-correct')){draft.questions[selectedQuestion].correct=Number(el.value);dirty=true;}
 if(el.id==='editor-select'){if(editorTab==='answers')selectedAnswer=Number(el.value);else selectedQuestion=Number(el.value);render();}
});
window.addEventListener('beforeunload',event=>{cancelChat();if(dirty){event.preventDefault();event.returnValue='';}});
async function init(){
 if(fileMode){connected=false;best=Math.max(0,Math.min(100,Number(readLocal('tobi-guest-best','0'))||0));if(!studio&&activityInfo().some(a=>a.id===location.hash.slice(1)))view=location.hash.slice(1);render();return;}
 const results=await Promise.allSettled([api('/api/tobi/config'),api('/api/auth/session'),api('/api/tobi/access')]);
 if(results[0].status==='fulfilled')acceptAIConfig(results[0].value);else connected=false;
 if(results[1].status==='fulfilled')user=results[1].value.user;
 if(results[2].status==='fulfilled'){access=results[2].value;connection=access.connection||null;}
 if(studio&&location.hash==='#ai')editorTab='ai';
 if(user){try{best=(await api('/api/tobi/progress')).best;}catch{}}
 else best=Math.max(0,Math.min(100,Number(readLocal('tobi-guest-best','0'))||0));
 if(!studio&&activityInfo().some(a=>a.id===location.hash.slice(1)&&a.enabled))view=location.hash.slice(1);
 render();
}
init();
