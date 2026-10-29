/* Aman — shared bilingual interface. Account data is stored only by the server. */
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
let language = 'ar';
try { language = localStorage.getItem('aman-language') === 'en' ? 'en' : 'ar'; localStorage.removeItem('user'); } catch {}
const t = (ar, en) => language === 'ar' ? ar : en;
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = document.body.dataset.page || 'home';
const filePreview = location.protocol === 'file:';
const staticPreview = !!document.querySelector('meta[name="aman-static-site"]');
let user = null;
let progress = { saved: [], checklist: [], quiz: null };
let sessionAvailable = !staticPreview;
let resourceFilter = 'all';
let resourceSearch = '';
let quizIndex = 0;
let quizAnswers = [];
let quizStarted = false;
let observer;

const icons = {
  rotate: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2"/>',
  reset: '<path d="M3 3v6h6M3 9a9 9 0 1 1 0 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  shield: '<path d="M12 3 20 6v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  arrowUp: '<path d="M7 17 17 7M7 7h10v10"/>',
  book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-5 2 1-5a9 9 0 1 1 17-5Z"/><path d="M8 10h8M8 14h5"/>',
  game: '<path d="M7 7h10a4 4 0 0 1 4 4l1 6a3 3 0 0 1-5 2l-3-2h-4l-3 2a3 3 0 0 1-5-2l1-6a4 4 0 0 1 4-4Z"/><path d="M7 10v6M4 13h6M16 11h.01M19 14h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18M10.5 5.2 12 5c6 0 10 7 10 7a21 21 0 0 1-3 4M6 6c-2.6 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2M10 10a3 3 0 0 0 4 4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  logout: '<path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  flag: '<path d="M5 21V3c5-3 9 3 14 0v10c-5 3-9-3-14 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const arrow = () => icon('arrow', 'direction-arrow');
const brand = () => `<a class="brand" href="index.html" aria-label="${t('أمان — الرئيسية', 'Aman — home')}"><span class="brand-mark">${icon('shield')}</span><span class="brand-name">${t('أمان', 'amān')}<small>${t('معًا، لإنترنت ألطف', 'a kinder internet')}</small></span></a>`;
const button = (label, href, variant = 'primary', symbol = 'arrow') => {
  if (staticPreview && /^(login|signup|dashboard)\.html/.test(href)) {
    href = 'interactive.html';
    label = t('ابدأ اللعب والتعلّم', 'Start learning and playing');
  }
  return `<a class="button button-${variant}" href="${href}">${label}${symbol === 'arrow' ? arrow() : icon(symbol)}</a>`;
};
const resources = () => [
  { id: 'unicef', category: 'young', logo: 'unicef', color: 'blue', name: t('دليل اليونيسف', 'The UNICEF guide'), description: t('ما هو التنمر الإلكتروني؟ وكيف توقفه؟ إجابات واضحة لأسئلتك المهمة.', 'What is cyberbullying, and how can you stop it? Clear answers to the questions that matter.'), label: t('للشباب', 'For young people'), url: t('https://www.unicef.org/ar/%D8%A7%D9%84%D8%AA%D9%86%D9%85%D9%91%D8%B1-%D8%B9%D8%A8%D8%B1-%D8%A7%D9%84%D8%A5%D9%86%D8%AA%D8%B1%D9%86%D8%AA-%D9%83%D9%8A%D9%81-%D9%86%D9%88%D9%82%D9%81%D9%87/%D8%A7%D9%84%D9%82%D8%B6%D8%A7%D8%A1-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%B9%D9%86%D9%81', 'https://www.unicef.org/stories/how-to-stop-cyberbullying') },
  { id: 'stopbullying', category: 'parents', logo: 'stopbullying.gov', color: 'peach', name: t('دليل الآباء والمعلمين', 'A guide for your grown-ups'), description: t('تعرّف على العلامات، وابدأ محادثة داعمة، وساعد في صنع التغيير.', 'Spot the signs, start a supportive conversation, and help make a difference.'), label: t('للآباء والمعلمين', 'For parents & teachers'), url: 'https://www.stopbullying.gov/cyberbullying/what-is-it' },
  { id: 'research', category: 'educators', logo: 'cyberbullying.org', color: 'purple', name: t('المعرفة تصنع فرقًا', 'Understanding makes a difference'), description: t('أبحاث وأدلة عملية تساعد المدارس والمجتمعات على مواجهة التنمر.', 'Research and practical guides to help schools and communities respond to bullying.'), label: t('للمعلمين', 'For educators'), url: 'https://cyberbullying.org/' },
  { id: 'nspcc', category: 'parents', logo: 'NSPCC', color: 'green', name: t('لنكن سندًا للأطفال', 'Be in their corner'), description: t('نصائح للحديث مع الأطفال عن التنمر وتقديم المساندة دون أحكام.', 'Advice for talking with children about bullying and giving support without judgment.'), label: t('للآباء', 'For parents'), url: 'https://www.nspcc.org.uk/' },
];
const questions = () => [
  { q: t('وصلتك رسالة مؤذية. ما أفضل خطوة أولى؟', 'You receive a hurtful message. What is a good first step?'), options: [t('أردّ برسالة مؤذية', 'Send something hurtful back'), t('أحفظ الدليل وأتحدث مع شخص أثق به', 'Save the evidence and tell someone I trust'), t('أنشر بيانات صاحب الرسالة', 'Post the sender’s private information')], correct: 1, why: t('لا تحتاج إلى الرد. احفظ لقطة شاشة، ثم اطلب الدعم من شخص موثوق.', 'You don’t have to respond. Save a screenshot, then reach out to someone you trust.') },
  { q: t('أي كلمة مرور تحمي حسابك بشكل أفضل؟', 'Which password would protect your account best?'), options: [t('اسمي وتاريخ ميلادي', 'My name and birthday'), '1234567890', t('عبارة طويلة وفريدة مع التحقق بخطوتين', 'A long, unique passphrase with two-step verification')], correct: 2, why: t('استخدم عبارة مرور فريدة لكل حساب، وفعّل التحقق بخطوتين متى أمكن.', 'Use a unique passphrase for every account, and turn on two-step verification when available.') },
  { q: t('رأيت صديقًا يتعرض للتنمر في مجموعة. ماذا تفعل؟', 'You see a friend being bullied in a group. What do you do?'), options: [t('أدعمه على انفراد وأبلّغ عن الإساءة', 'Support them privately and report the abuse'), t('أشارك المنشور حتى يراه الجميع', 'Share the post so everyone sees it'), t('أضع إعجابًا لأبقى مع المجموعة', 'Like it to fit in with the group')], correct: 0, why: t('كلمة دعم خاصة قد تصنع فرقًا. الإبلاغ أفضل من إعادة نشر المحتوى المؤذي.', 'A private message of support can make a difference. Report harmful content instead of spreading it.') },
  { q: t('شخص يطلب عنوانك وصورًا خاصة. كيف تتصرف؟', 'Someone asks for your address and private photos. What should you do?'), options: [t('أرسلها إذا وعد بعدم نشرها', 'Send them if they promise not to share'), t('أرفض، وأحظره، وأخبر شخصًا موثوقًا', 'Say no, block them, and tell a trusted person'), t('أعطيه بيانات صديقي بدلًا مني', 'Give them my friend’s information instead')], correct: 1, why: t('خصوصيتك حق لك. لا تشارك معلومات حساسة، واطلب مساعدة شخص بالغ موثوق إذا شعرت بالضغط.', 'Your privacy matters. Don’t share sensitive information, and ask a trusted adult for help if you feel pressured.') },
  { q: t('هل طلب المساعدة عند التعرض للتنمر علامة ضعف؟', 'Is asking for help with bullying a sign of weakness?'), options: [t('نعم، يجب أن أحل كل شيء وحدي', 'Yes, I should handle everything alone'), t('فقط إذا كنت أعرف المتنمر', 'Only if I know the bully'), t('لا، طلب الدعم خطوة شجاعة', 'No, reaching out is a brave step')], correct: 2, why: t('أنت لست وحدك، وما حدث ليس خطأك. طلب المساعدة حق وخطوة نحو الأمان.', 'You are not alone, and what happened isn’t your fault. You deserve help and support.') },
];

function header() {
  const links = [['home', 'index.html', t('الرئيسية', 'Home')], ['about', 'about.html', t('عن التنمر', 'Understand bullying')], ['resources', 'resources.html', t('الموارد', 'Resources')], ['interactive', 'interactive.html', t('تعلّم وتفاعل', 'Learn & play')]];
  return `<a class="skip-link" href="#main">${t('انتقل إلى المحتوى', 'Skip to content')}</a><header class="site-header"><div class="container header-inner">${brand()}<nav class="main-nav" id="main-nav" aria-label="${t('القائمة الرئيسية', 'Main navigation')}">${links.map(([id, href, text]) => `<a href="${href}" ${page === id ? 'class="active" aria-current="page"' : ''}>${text}</a>`).join('')}</nav><div class="header-actions"><button class="language-button" type="button" data-language aria-label="${t('Switch to English', 'التبديل إلى العربية')}">${icon('globe')}<span>${t('EN', 'عربي')}</span></button><div id="account-nav">${accountNav()}</div><button class="menu-button" type="button" aria-controls="main-nav" aria-expanded="false" aria-label="${t('فتح القائمة', 'Open menu')}">${icon('menu')}</button></div></div></header>`;
}
function accountNav() {
  if (staticPreview) return button(t('العب واستكشف', 'Play & explore'), 'interactive.html', 'small button-dark');
  return user ? `<a class="account-link" href="dashboard.html"><span class="avatar small-avatar">${escapeHTML(user.name.slice(0, 1))}</span><span>${t('مساحتي', 'My space')}</span></a><button class="logout-button" type="button" data-logout aria-label="${t('تسجيل الخروج', 'Log out')}">${icon('logout')}</button>` : `<a class="login-link" href="login.html">${t('دخول', 'Log in')}</a><a class="button button-small button-dark" href="signup.html">${t('انضم إلينا', 'Join us')}${arrow()}</a>`;
}
function footer() {
  return `<footer class="site-footer"><div class="container"><div class="footer-main"><div>${brand()}<p>${t('خطوة صغيرة منك، وإنترنت ألطف للجميع.', 'Small steps from you. A kinder internet for everyone.')}</p></div><div class="footer-links"><a href="about.html">${t('عن أمان', 'About Aman')}</a><a href="resources.html">${t('الموارد', 'Resources')}</a><button type="button" class="text-button" data-support>${t('أحتاج مساعدة', 'Get support')}</button><a href="privacy.html">${t('الخصوصية', 'Privacy')}</a></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} ${t('أمان. صُنع ليكون مساحة ألطف.', 'Aman. Made for a kinder world.')}</span><span class="made-with">${t('قليل من اللطف، كثير من الأثر', 'A little kindness goes a long way')}${icon('heart')}</span></div></div></footer>`;
}
function illustration(compact = false) {
  return `<div class="kindness-world ${compact ? 'compact-world' : ''}" aria-label="${t('رسم تعبيري لرسائل داعمة ومساحة رقمية آمنة', 'An illustration of kind messages in a safe digital space')}" role="img"><div class="world-orbit orbit-one"></div><div class="world-orbit orbit-two"></div><span class="world-star star-one">✳</span><span class="world-star star-two">✧</span><span class="world-dot dot-one"></span><span class="world-dot dot-two"></span><div class="floating-sticker heart-sticker">${icon('heart')}</div><div class="mini-pill floating-one"><span class="tiny-online"></span>${t('اللطف يبدأ منك', 'kindness starts with you')}</div><div class="browser-card"><div class="browser-bar"><div class="browser-dots"><i></i><i></i><i></i></div><span>your.safe.space</span>${icon('lock')}</div><div class="browser-body"><span class="illustration-eyebrow">${t('تذكير صغير لك', 'YOUR DAILY REMINDER')}</span><div class="happy-flower"><span class="flower-petal petal-one"></span><span class="flower-petal petal-two"></span><span class="flower-petal petal-three"></span><span class="flower-face"><i></i><i></i><b></b></span></div><div class="illustration-title">${t('مكانك هنا.', 'You belong here.')}<span>${t('كما أنت تمامًا.', 'Just as you are.')}</span></div><div class="kind-message"><span class="message-avatar">${icon('heart')}</span><div><b>${t('صوتك يستحق أن يُسمع', 'Your voice matters')}</b><small>${t('وأنت تستحق أن تشعر بالأمان', 'And you deserve to feel safe.')}</small></div><span class="message-heart">♡</span></div><div class="message-reactions"><span>💜 24</span><span>✨ 12</span><span>🌱 8</span></div></div></div><div class="safe-sticker">${icon('shield')}<div><b>${t('مساحة آمنة', 'Safe space')}</b><small>${t('كن أنت، بكل ثقة', 'Be unapologetically you')}</small></div><span class="sticker-check">${icon('check')}</span></div><div class="floating-sticker smile-sticker"><span>⌣</span><i></i><i></i></div><div class="world-caption">${t('الإنترنت أجمل بوجودك', 'THE INTERNET IS BETTER WITH YOU IN IT')}<span>↗</span></div></div>`;
}
function featureCard(number, symbol, color, title, description, href, link) {
  return `<article class="feature-card reveal"><div class="card-top"><span class="icon-box ${color}">${icon(symbol)}</span><span class="card-number">0${number}</span></div><h3>${title}</h3><p>${description}</p><a class="card-link" href="${href}">${link}${arrow()}</a></article>`;
}
function resourceCard(resource) {
  const saved = progress.saved.includes(resource.id);
  return `<article class="resource-card reveal" data-resource="${resource.id}"><div class="resource-art ${resource.color}"><span class="resource-logotype">${resource.logo}</span><span class="resource-art-mark">${icon(resource.id === 'unicef' ? 'globe' : resource.id === 'nspcc' ? 'heart' : 'book')}</span></div><div class="resource-content"><div class="resource-meta"><span>${resource.label}</span><button type="button" class="save-button ${saved ? 'saved' : ''}" data-save="${resource.id}" aria-pressed="${saved}" aria-label="${t('حفظ ', 'Save ')}${resource.name}">${icon('bookmark')}</button></div><h3>${resource.name}</h3><p>${resource.description}</p><a href="${resource.url}" target="_blank" rel="noopener noreferrer" class="card-link">${t('استكشف الدليل', 'Explore the guide')}${icon('arrowUp')}<span class="sr-only">${t('(يفتح في نافذة جديدة)', '(opens in a new tab)')}</span></a></div></article>`;
}
function cta() {
  return `<section class="container section-block"><div class="community-banner reveal"><div class="banner-spark">✳</div><div><span class="eyebrow">${t('التغيير يبدأ بخطوة', 'A SMALL STEP. A REAL DIFFERENCE.')}</span><h2>${t('لنصنع إنترنت نفتخر به.', 'Let’s make the internet a little kinder.')}</h2><p>${t('تعلّم، احمِ نفسك، وكن سببًا في ابتسامة أحدهم اليوم.', 'Learn a little. Look out for each other. Be someone’s reason to smile today.')}</p></div>${button(t('ابدأ رحلتك معنا', 'Start your journey'), user ? 'dashboard.html' : 'signup.html', 'dark')}</div></section>`;
}
function sceneWorld() {
  return `<div class="scene-shell" data-scene-shell>
    <div class="scene-topline"><span class="scene-label">${icon('spark')}${t('عالم أمان الصغير', 'A LITTLE WORLD OF KINDNESS')}</span><span class="scene-index" aria-hidden="true">01 / AMĀN</span></div>
    <div class="scene-art">
      <div class="scene-stage" data-aman-scene role="img" aria-label="${t('مجسّم ثلاثي الأبعاد: درع موف بعلامة صح، وقلب ورسالة دعم حوله', 'A 3D lavender shield surrounded by a heart and a kind message')}">
        <div class="scene-fallback" data-scene-fallback aria-hidden="true"><span class="fallback-orbit"></span><span class="fallback-heart">${icon('heart')}</span><span class="fallback-shield">${icon('shield')}</span><span class="fallback-chat">${icon('chat')}</span><span class="fallback-base"></span></div>
      </div>
      <span class="scene-floating scene-floating-kind">${icon('heart')}${t('كلمة حلوة بتفرق', 'Kind words matter')}</span>
      <span class="scene-floating scene-floating-safe"><span class="tiny-online"></span>${t('مكانك هنا، زي ما أنت', 'You belong. Just as you are.')}</span>
      <span class="scene-doodle" aria-hidden="true">✳</span>
    </div>
    <div class="scene-controls" role="group" aria-label="${t('التحكم في المجسّم', '3D scene controls')}">
      <span class="scene-hint">${t('اكتشفها من كل ناحية', 'A little change in perspective')}</span>
      <button type="button" class="scene-button scene-turn" data-scene-turn>${icon('rotate')}<span>${t('لفّ المجسّم', 'Rotate')}</span></button>
      <button type="button" class="scene-button scene-icon-button" data-scene-reset aria-label="${t('رجّع الشكل الأصلي', 'Reset view')}" title="${t('رجّع الشكل الأصلي', 'Reset view')}">${icon('reset')}</button>
      <button type="button" class="scene-button scene-icon-button" data-scene-motion aria-pressed="false" aria-label="${t('إيقاف الحركة', 'Pause motion')}" data-pause-label="${t('إيقاف الحركة', 'Pause motion')}" data-play-label="${t('تشغيل الحركة', 'Play motion')}" title="${t('تشغيل أو إيقاف الحركة', 'Play or pause motion')}"><span class="motion-pause">${icon('pause')}</span><span class="motion-play">${icon('play')}</span></button>
    </div>
  </div>`;
}
function journeyCard(number, symbol, color, title, description, href, link, meta) {
  return `<article class="journey-card journey-${color} reveal"><div class="journey-art" aria-hidden="true"><span class="journey-number">0${number}</span><div class="dimensional-icon"><span class="dimensional-back"></span><span class="dimensional-front">${icon(symbol)}</span></div><span class="journey-spark">✧</span><span class="journey-art-caption">${meta}</span></div><div class="journey-content"><h3>${title}</h3><p>${description}</p><a class="card-link" href="${href}">${link}<span>${arrow()}</span></a></div></article>`;
}
const kindnessNotes = () => [
  [t('وجودك بيفرق.\nومكانك وسطنا.', 'You make a difference.\nYou belong here.'), t('أحيانًا جملة بسيطة بتخلّي حد يحس إنه مش لوحده.', 'Sometimes a few words help someone feel less alone.')],
  [t('اللي حصل مش غلطتك.\nأنا جنبك.', 'This isn’t your fault.\nI’m here for you.'), t('اسمع من غير لوم. الدعم بيبدأ بإحساس إن فيه حد فاهم.', 'Listen without blame. Support starts with feeling understood.')],
  [t('مش لازم تواجه ده لوحدك.\nنطلب مساعدة سوا؟', 'You don’t have to face this alone.\nShall we find help together?'), t('اعرض المساعدة، وسيب لصاحبك مساحة يختار اللي يريّحه.', 'Offer help, and give your friend room to choose what feels right.')],
  [t('من حقك تكون على طبيعتك.\nومن حقك تحس بالأمان.', 'You deserve to be yourself.\nYou deserve to feel safe.'), t('اختلافنا مش سبب للإساءة. كل واحد يستحق الاحترام.', 'Our differences never justify bullying. Everyone deserves respect.')],
];
let kindnessIndex = 0;
function kindnessSection() {
  const [note, caption] = kindnessNotes()[kindnessIndex];
  return `<section class="container section-block kindness-section"><div class="kindness-copy reveal"><span class="eyebrow">${t('سيب أثر حلو', 'LEAVE A LITTLE KINDNESS')}</span><h2>${t('الكلمة الحلوة<br>بتوصل أبعد ما تتخيّل.', 'A few kind words.<br>A bigger difference.')}</h2><p>${t('مش لازم يكون عندك كل الإجابات عشان تبقى سند لحد. ابدأ بكلمة بسيطة، واسمعه بجد.', 'You don’t need all the answers to be there for someone. Start with a few honest words, and really listen.')}</p><a class="text-link" href="about.html">${t('إزاي أساند صاحبي؟', 'How can I support a friend?')}${arrow()}</a></div><div class="kindness-postcard-wrap reveal"><div class="kindness-postcard" data-kindness-card><div class="postcard-heading"><span>${t('رسالة ليك، أو لحد يهمّك', 'FOR YOU, OR SOMEONE YOU CARE ABOUT')}</span>${icon('heart')}</div><div class="postcard-message" aria-live="polite" aria-atomic="true"><p data-kindness-note>${escapeHTML(note)}</p><span data-kindness-caption>${caption}</span></div><div class="postcard-footer"><span class="postcard-signature">${t('بكل لطف، أمان', 'With kindness, Aman')}<span aria-hidden="true">♡</span></span><button type="button" class="postcard-next" data-kindness-next>${t('رسالة كمان', 'Another kind thought')}${icon('rotate')}</button></div></div><span class="postcard-doodle" aria-hidden="true">✿</span></div></section>`;
}
function home() {
  return `<section class="hero-section"><div class="container hero-grid"><div class="hero-copy">
    <span class="eyebrow hero-eyebrow"><span class="live-dot"></span>${t('مساحة للتعلّم، واللعب، والدعم', 'A SPACE TO LEARN, PLAY & BELONG')}</span>
    <h1>${t('عالمك الرقمي.<br>خلّيه <span class="highlight-word">أكثر أمانًا.<svg viewBox="0 0 320 20" aria-hidden="true"><path d="M3 14Q160-6 317 10"/></svg></span>', 'Your digital world.<br>A little <span class="highlight-word">kinder.<svg viewBox="0 0 320 20" aria-hidden="true"><path d="M3 14Q160-6 317 10"/></svg></span>')}</h1>
    <p class="hero-description">${t('كلمة حلوة بتفرق، وخطوة صغيرة بتحمي. تعلّم تواجه التنمّر، جرّب تحدّياتنا، وخليك سند لغيرك.', 'Kind words matter. Small steps protect us. Learn to stand up to cyberbullying, try a challenge, and be there for someone.')}</p>
    <div class="hero-buttons">${button(t('يلا نجرّب التحدّي', 'Take the kindness challenge'), 'interactive.html#quiz', 'primary', 'game')}<button class="button button-white" type="button" data-support>${icon('chat')}${t('محتاج مساعدة', 'I need support')}</button></div>
    <div class="hero-note"><span class="hero-note-mark">${icon('check')}</span><span>${t('على راحتك. مجانًا، ومن غير حساب.', 'At your pace. Free, with no account needed.')}</span></div>
    <a class="hero-explore" href="#explore">${t('اكتشف مساحتك', 'Find your own starting point')}<span aria-hidden="true">↓</span></a>
  </div>${sceneWorld()}</div><div class="container hero-bottom"><span>${icon('shield')}${t('افهم حقوقك واحمِ نفسك', 'Know your rights. Protect your space.')}</span><span>${icon('heart')}${t('اختلافنا يكمّلنا', 'Room for all of us, just as we are.')}</span><span>${icon('spark')}${t('خطوة صغيرة، أثر حقيقي', 'Small steps. Real change.')}</span></div></section>
  <section class="container section-block journey-section" id="explore"><div class="section-heading reveal"><div><span class="eyebrow">${t('كل بداية ليها طريق', 'THERE’S NO ONE WAY TO START')}</span><h2>${t('ابدأ باللي محتاجه.', 'What brings you here?')}</h2></div><p>${t('تفهم أكتر، تساعد صاحبك، أو تتعلّم بلعبة.<br>اختار خطوتك، وإحنا معاك.', 'Understand a little more. Look out for a friend.<br>Or learn something through play.')}</p></div>
  <div class="journey-grid">${journeyCard(1, 'shield', 'lavender', t('افهم، عشان تقدر تواجه', 'Make sense of what’s happening'), t('اعرف الفرق بين الهزار والإساءة، وإيه اللي تقدر تعمله لو التنمّر حصلك أو حصل لحد تعرفه.', 'Learn the difference between a joke and harm, and what to do when bullying affects you or someone you know.'), 'about.html', t('خلّينا نفهم سوا', 'Understand cyberbullying'), t('اعرف حقّك', 'KNOW YOUR RIGHTS'))}${journeyCard(2, 'book', 'mint', t('خطوتك الجاية أوضح', 'Find your next step'), t('مصادر موثوقة من اليونيسف وغيرها، فيها خطوات عملية ليك وللناس اللي بيهتمّوا بيك.', 'Trusted guides from UNICEF and others, with practical advice for you and the people who care about you.'), 'resources.html', t('افتح مكتبة الموارد', 'Explore the resources'), t('خليك مستعد', 'BUILD YOUR CONFIDENCE'))}${journeyCard(3, 'game', 'peach', t('شوية لعب، كتير تعلّم', 'A little play. A lot to learn.'), t('خمسة مواقف، وألعاب تخلّي المعلومة تعيش معاك. جرّب، اغلط، واتعلّم على راحتك.', 'Five everyday situations and games that make learning stick. Try things out, make mistakes, and go at your pace.'), 'interactive.html', t('اختار مغامرتك', 'Choose your adventure'), t('جرّب بنفسك', 'LEARN BY PLAYING'))}</div></section>
  <section class="container section-block"><div class="quiz-spotlight reveal"><div class="quiz-visual" aria-hidden="true"><span class="quiz-spark">✦</span><div class="quiz-stack back-stack"></div><div class="quiz-stack front-stack"><span class="quiz-card-label">${t('تحدّي أمان', 'THE KINDNESS CHECK')}</span><div class="quiz-big-mark">?</div><div class="quiz-example"><span>A</span><i></i></div><div class="quiz-example correct"><span>B</span><i></i>${icon('check')}</div><div class="quiz-example"><span>C</span><i></i></div></div><span class="quiz-floating-check">${icon('check')}</span><span class="quiz-mini-label">${icon('spark')} ${t('كل اختيار بيعلّمك', 'EVERY CHOICE TEACHES YOU')}</span></div><div class="spotlight-copy"><span class="pill-label">${icon('game')}${t('جاهز لتحدٍ صغير؟', 'UP FOR A LITTLE CHALLENGE?')}</span><h2>${t('لو كنت مكانه،<br>هتعمل إيه؟', 'If it were you,<br>what would you do?')}</h2><p>${t('رسالة مؤذية، أو صاحبك بيتعرّض للتنمّر؟ جرّب خمسة مواقف من حياتنا على النت، واكتشف ردّ فعل يساعد بجد.', 'A hurtful message. A friend being picked on. Explore five moments from life online, and discover a response that really helps.')}</p><div class="quiz-meta"><span>${icon('clock')}${t('٣ دقائق', '3 minutes')}</span><span>${icon('check')}${t('٥ مواقف', '5 situations')}</span><span>${icon('heart')}${t('على راحتك', 'At your pace')}</span></div>${button(t('ابدأ التحدّي', 'Let’s give it a go'), 'interactive.html#quiz', 'dark')}</div></div></section>
  ${kindnessSection()}
  <section class="container section-block home-resources"><div class="section-heading reveal"><div><span class="eyebrow">${t('معلومة من مكان تثق فيه', 'GOOD GUIDANCE. TRUSTED SOURCES.')}</span><h2>${t('مش لازم تدوّر لوحدك.', 'You don’t have to figure it out alone.')}</h2></div><a class="text-link" href="resources.html">${t('كل الموارد', 'All resources')}${arrow()}</a></div><div class="resources-grid">${resources().slice(0, 3).map(resourceCard).join('')}</div></section>${cta()}`;
}
function pageHeading(eyebrow, title, description) {
  return `<section class="page-heading container"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></section>`;
}
function about() {
  const types = [
    ['chat', 'purple', t('رسائل وكلمات مؤذية', 'Hurtful messages'), t('إهانات أو تهديدات أو تعليقات جارحة تُرسل بشكل متكرر.', 'Repeated insults, threats, or hurtful comments in messages and online conversations.')],
    ['flag', 'peach', t('شائعات وتشهير', 'Rumours & public shaming'), t('نشر معلومات كاذبة أو صور خاصة دون موافقة صاحبها.', 'Spreading false information or sharing private photos without someone’s permission.')],
    ['user', 'green', t('انتحال شخصية', 'Impersonation'), t('استخدام حساب مزيف للتظاهر بأنك شخص آخر والإساءة إليه.', 'Using a fake account to pretend to be someone else and damage their reputation.')],
    ['heart', 'blue', t('استبعاد متعمد', 'Deliberate exclusion'), t('عزل شخص عن المجموعات الرقمية بهدف إيذائه أو إحراجه.', 'Intentionally leaving someone out of online groups to hurt or embarrass them.')],
  ];
  return `${pageHeading(t('المعرفة هي البداية', 'UNDERSTANDING IS THE FIRST STEP'), t('نسمي الأشياء باسمها.<br><span class="purple-text">ونواجهها معًا.</span>', 'Let’s name it.<br><span class="purple-text">Then change it.</span>'), t('التنمر ليس جزءًا طبيعيًا من الإنترنت. تعرّف عليه، وتعلّم كيف تستعيد شعورك بالأمان.', 'Bullying doesn’t have to be part of being online. Learn to recognise it, and find your way back to feeling safe.'))}<section class="container section-block"><div class="definition-panel reveal"><span class="large-icon">${icon('chat')}</span><div><h2>${t('ما هو التنمر الإلكتروني؟', 'What is cyberbullying?')}</h2><p>${t('هو استخدام التكنولوجيا الرقمية لإيذاء شخص أو تخويفه أو إحراجه بشكل متكرر. قد يحدث على وسائل التواصل، أو في الألعاب، أو عبر الرسائل. وإذا كان «المزاح» يؤلمك ولا يتوقف عندما تطلب، فمن حقك أن تطلب المساعدة. حتى الإساءة التي تحدث مرة واحدة تستحق التعامل معها.', 'Cyberbullying is repeated behaviour using digital technology to hurt, scare, or shame someone. It can happen on social media, in games, or through messages. If a “joke” hurts and doesn’t stop when you ask, you deserve support. Even a one-off harmful incident is worth addressing.')}</p></div></div><div class="section-heading"><div><span class="eyebrow">${t('قد يأخذ أكثر من شكل', 'IT CAN LOOK DIFFERENT')}</span><h2>${t('تعرّف على العلامات.', 'Know what to look for.')}</h2></div></div><div class="types-grid">${types.map(([symbol, color, title, description]) => `<article class="feature-card reveal"><span class="icon-box ${color}">${icon(symbol)}</span><h3>${title}</h3><p>${description}</p></article>`).join('')}</div></section><section class="container section-block"><div class="section-heading"><div><span class="eyebrow">${t('خطوتك التالية', 'TAKE IT ONE STEP AT A TIME')}</span><h2>${t('أربع خطوات. وأنت أقوى.', 'Four steps towards feeling safer.')}</h2></div></div><div class="steps-grid">${supportSteps().map((step, i) => `<article class="step-card reveal"><span class="step-number">0${i + 1}</span><h3>${step[0]}</h3><p>${step[1]}</p></article>`).join('')}</div></section><section class="container section-block faq-section"><div><span class="eyebrow">${t('أسئلتك مهمة', 'THERE ARE NO SILLY QUESTIONS')}</span><h2>${t('يمكن هذا اللي<br>يدور في بالك.', 'Maybe this is<br>on your mind.')}</h2><button class="button button-primary" type="button" data-support>${t('أحتاج بعض الدعم', 'Find a little support')}${icon('heart')}</button></div><div class="faq-list">${[
    [t('كيف أعرف الفرق بين المزاح والتنمر؟', 'How do I tell a joke from bullying?'), t('المزاح يجعل الطرفين يشعران بالراحة. إذا شعرت بالأذى، أو استمر السلوك بعد طلب التوقف، فهذه علامة تستحق الانتباه. لست بحاجة لإثبات أن الأمر «خطير كفاية» حتى تطلب الدعم.', 'A joke should feel okay for everyone involved. If you feel hurt, or the behaviour continues after you ask it to stop, take it seriously. You don’t have to prove it is “bad enough” to ask for support.')],
    [t('ماذا لو كان المتنمر صديقي؟', 'What if it’s someone I’m friends with?'), t('من حقك وضع حدود حتى مع الأصدقاء. أخبره بهدوء أن السلوك يؤذيك، وإذا لم يتوقف، ابتعد عنه وتحدث إلى شخص تثق به.', 'You’re allowed to set boundaries with friends, too. If it feels safe, explain that the behaviour hurts. If it continues, step back and speak with someone you trust.')],
    [t('كيف أساند شخصًا يتعرض للتنمر؟', 'How can I support someone being bullied?'), t('استمع دون لوم، وذكّره بأن ما حدث ليس خطأه. لا تشارك المحتوى المسيء. اعرض مساعدته في حفظ الدليل والإبلاغ والحديث مع شخص موثوق.', 'Listen without blaming them, and remind them it isn’t their fault. Don’t spread harmful content. Offer to help save evidence, report the behaviour, and find a trusted person to talk to.')],
    [t('هل يجب أن أحذف حساباتي؟', 'Do I have to delete my accounts?'), t('ليس بالضرورة. جرّب إعدادات الخصوصية والحظر والإبلاغ، وخذ استراحة إذا احتجتها. يمكنك اختيار ما يساعدك على الشعور بالأمان بمساندة شخص تثق به.', 'Not necessarily. Try privacy settings, blocking, and reporting, and take a break if you need one. A trusted person can help you decide what makes you feel safer.')],
  ].map(([q, a]) => `<details><summary>${q}<span>+</span></summary><p>${a}</p></details>`).join('')}</div></section>${cta()}`;
}
function resourcesPage() {
  return `${pageHeading(t('أدوات تساعدك فعلًا', 'A LITTLE HELP, A LOT OF POSSIBILITY'), t('معرفة موثوقة.<br><span class="purple-text">في متناولك.</span>', 'Good guidance.<br><span class="purple-text">Within reach.</span>'), t('أدلة ومصادر مختارة من مؤسسات معروفة. لك، وللأشخاص الذين يهتمون بك.', 'Handpicked guides from established organisations. For you, and the people looking out for you.'))}<section class="container section-block resource-library"><div class="resource-toolbar"><div class="filter-tabs" role="group" aria-label="${t('تصفية الموارد', 'Filter resources')}">${[['all', t('الكل', 'All resources')], ['young', t('للشباب', 'Young people')], ['parents', t('للآباء', 'Parents')], ['educators', t('للمعلمين', 'Educators')]].map(([id, label]) => `<button type="button" data-filter="${id}" class="filter-tab ${resourceFilter === id ? 'selected' : ''}" aria-pressed="${resourceFilter === id}">${label}</button>`).join('')}</div><label class="search-field">${icon('search')}<input type="search" id="resource-search" value="${escapeHTML(resourceSearch)}" placeholder="${t('ابحث عن مورد...', 'Find a resource…')}" aria-label="${t('ابحث عن مورد', 'Search resources')}"></label></div><p class="resource-count" id="resource-count" role="status"></p><div class="resources-grid" id="resource-results"></div></section><section class="container section-block"><div class="support-banner reveal"><span class="icon-box purple">${icon('heart')}</span><div><h2>${t('ليس عليك أن تواجه كل شيء وحدك.', 'You don’t have to figure it out alone.')}</h2><p>${t('ابدأ بخطوة بسيطة نحو الأمان، وتواصل مع شخص تثق به.', 'Start with one small step towards safety, and reach out to someone you trust.')}</p></div><button class="button button-dark" type="button" data-support>${t('خطوات للمساعدة', 'Find your next step')}${arrow()}</button></div></section>`;
}
function interactive() {
  return `${pageHeading(t('قليل من اللعب، كثير من الوعي', 'PLAY A LITTLE. LEARN A LOT.'), t('مهارات حقيقية.<br><span class="purple-text">بطريقتك أنت.</span>', 'Real-life superpowers.<br><span class="purple-text">Your way.</span>'), t('تحديات صغيرة وألعاب تعليمية تساعدك على بناء ثقتك الرقمية. خذ وقتك واستمتع.', 'Small challenges and thoughtful games to build your digital confidence. Take your time. Have a little fun.'))}<section class="container section-block" id="quiz"><div class="quiz-panel reveal" id="quiz-panel">${quizContent()}</div></section><section class="container section-block"><div class="section-heading"><div><span class="eyebrow">${t('تعلّم بالمغامرة', 'KEEP YOUR CURIOSITY PLAYING')}</span><h2>${t('جاهز لمغامرة جديدة؟', 'Ready for a little adventure?')}</h2></div><p>${t('توبي وأنقذ العالم: اختار مغامرتك.', 'Chat with Tobi, or play the updated Save the World.')}</p></div><div class="games-grid"><article class="game-card reveal"><div class="game-art robot-art"><img src="9.png" alt="${t('صورة من لعبة الروبوت', 'Robot game artwork')}" loading="lazy"><span class="game-art-decoration">✦</span></div><div class="game-content"><span class="eyebrow">${t('اسأل واكتشف', 'ASK. EXPLORE. DISCOVER.')}</span><h3>${t('مساحة توبي الآمنة', 'Tobi’s Safe Space')}</h3><p>${t('جرّب لعبة الروبوت التعليمية واستكشف موضوعات جديدة عن عالمك الرقمي.', 'Explore an educational robot game and discover more about your digital world.')}</p><a class="card-link" href="tobi.html">${t('العب مع توبي هنا', 'Play with Tobi here')}${icon('arrowUp')}</a></div></article><article class="game-card reveal world-game"><div class="game-art world-art"><img src="save-world-preview.png" alt="${t('مشهد من النسخة العربية المحسّنة من أنقذ العالم', 'Gameplay from the updated Arabic Save the World')}" width="1280" height="800" loading="lazy"></div><div class="game-content"><span class="eyebrow">${t('النسخة العربية الجديدة', 'THE UPDATED ARABIC EDITION')}</span><h3>${t('أنقذ العالم', 'Save the world')}</h3><p>${t('٣ حكايات عن التنمّر. اجمع الكلمات اللي بتسند لحد ١٠٠٠ نقطة، وتجنّب الكلام المؤذي. العب النسخة المحسّنة من متصفحك.', 'Three stories about bullying. Collect supportive words to reach 1,000 points and avoid hurtful ones. Play the improved game in your browser.')}</p><a class="card-link" href="https://ezz-king33.itch.io/save-the-world-with-godot" target="_blank" rel="noopener noreferrer">${t('العب النسخة الجديدة', 'Play the new version')}${icon('arrowUp')}</a></div></article></div></section>`;
}
function quizContent() {
  if (!quizStarted) return `<div class="quiz-intro"><span class="icon-box purple">${icon('game')}</span><span class="eyebrow">${t('تحدّي أمان', 'THE DIGITAL KINDNESS CHECK')}</span><h2>${t('ماذا ستفعل لو...؟', 'What would you do if…?')}</h2><p>${t('٥ مواقف، ٣ دقائق، ومهارات تبقى معك. لا توجد مؤقتات أو ضغوط هنا.', '5 situations, 3 minutes, and skills that stick. No timers. No pressure.')}</p><button class="button button-primary" type="button" data-start-quiz>${t('لنبدأ التحدّي', 'Let’s give it a go')}${arrow()}</button><small>${t('متاح للجميع. سجّل الدخول لحفظ أفضل نتيجتك.', 'Open to everyone. Log in to save your best score.')}</small></div>`;
  if (quizIndex >= questions().length) {
    const score = quizAnswers.filter((answer, i) => answer === questions()[i].correct).length;
    return `<div class="quiz-intro quiz-result" tabindex="-1"><div class="result-medal">${icon(score >= 4 ? 'shield' : 'spark')}</div><span class="eyebrow">${t('خطوة رائعة للأمام', 'THAT’S A STEP FORWARD')}</span><h2>${t('تعلمت شيئًا يستحق!', 'Look at you, learning something good!')}</h2><div class="result-score">${score}<span> / 5</span></div><p>${t('كل إجابة فرصة للتعلّم. جرّب استخدام واحدة من هذه النصائح اليوم.', 'Every answer is a chance to learn. Try putting one of these ideas into practice today.')}</p><div class="hero-buttons"><button class="button button-primary" type="button" data-restart-quiz>${t('جرّب مرة أخرى', 'Try it again')}${icon('game')}</button>${button(user ? t('شاهد تقدّمك', 'See your progress') : t('دخول لحفظ نتيجتك', 'Log in to save your score'), user ? 'dashboard.html' : 'login.html?next=interactive.html', 'white')}</div><p class="quiz-save-note" id="quiz-save-note" role="status"></p></div>`;
  }
  const question = questions()[quizIndex];
  const selected = quizAnswers[quizIndex];
  const answered = selected !== undefined;
  return `<div class="quiz-question" tabindex="-1"><div class="quiz-question-top"><span class="eyebrow">${t('تحدّي أمان', 'THE DIGITAL KINDNESS CHECK')}</span><span>${quizIndex + 1} / 5</span></div><progress class="quiz-progress" max="5" value="${quizIndex + (answered ? 1 : 0)}" aria-label="${t('تقدم الاختبار', 'Quiz progress')}"></progress><h2>${question.q}</h2><div class="quiz-options">${question.options.map((option, i) => `<button type="button" data-answer="${i}" class="quiz-option ${answered && i === question.correct ? 'is-correct' : ''} ${answered && i === selected && i !== question.correct ? 'is-incorrect' : ''}" ${answered ? 'disabled' : ''}><span class="option-letter">${['A', 'B', 'C'][i]}</span><span>${option}</span>${answered && i === question.correct ? icon('check') : ''}</button>`).join('')}</div>${answered ? `<div class="answer-feedback" role="status"><strong>${selected === question.correct ? t('بالضبط! خطوة تحميك.', 'Exactly. That’s a step towards safety.') : t('فرصة نتعلم منها.', 'Here’s something to take with you.')}</strong><p>${question.why}</p></div><button class="button button-primary" type="button" data-next-question>${quizIndex === 4 ? t('شاهد النتيجة', 'See how you did') : t('السؤال التالي', 'Next question')}${arrow()}</button>` : `<p class="quiz-hint">${t('اختر التصرف الذي تراه أنسب.', 'Pick the response that feels right to you.')}</p>`}</div>`;
}
function auth(signup) {
  if (staticPreview) return staticAccountNotice();
  return `<section class="container auth-layout"><div class="auth-story"><span class="eyebrow">${t('مساحتك الصغيرة للتغيير', 'YOUR LITTLE CORNER OF CHANGE')}</span><h1>${t('أنت تنتمي هنا.<br><span class="purple-text">كما أنت.</span>', 'You belong here.<br><span class="purple-text">Just as you are.</span>')}</h1><p>${t('احفظ مواردك المفضلة، تابع تقدّمك، وابدأ رحلتك نحو إنترنت أكثر لطفًا.', 'Save your favourite resources, celebrate your progress, and find your way to a kinder internet.')}</p>${illustration(true)}<div class="auth-assurance">${icon('shield')}<span>${t('نتعلم معًا. ونكبر معًا.', 'A place to learn. A little room to grow.')}</span></div></div><div class="auth-form-area"><a class="back-link" href="index.html">${arrow()}${t('العودة للرئيسية', 'Back to home')}</a><div class="auth-tabs"><a href="login.html" ${!signup ? 'class="selected" aria-current="page"' : ''}>${t('تسجيل الدخول', 'Log in')}</a><a href="signup.html" ${signup ? 'class="selected" aria-current="page"' : ''}>${t('إنشاء حساب', 'Sign up')}</a></div><h2>${signup ? t('بداية صغيرة، أثر كبير.', 'Good things start here.') : t('أهلًا بعودتك!', 'Hey, welcome back!')}</h2><p class="auth-intro">${signup ? t('أنشئ حسابك المجاني. سعيدون بوجودك معنا.', 'Make yourself at home. Create your free account.') : t('مساحتك الآمنة في انتظارك. لنكمل الرحلة.', 'Your little corner is waiting. Let’s pick up where you left off.')}</p><form id="auth-form" data-mode="${signup ? 'signup' : 'login'}">${signup ? `<div class="form-field"><label for="name">${t('بماذا نناديك؟', 'What should we call you?')}</label><input id="name" name="name" type="text" autocomplete="nickname" minlength="2" maxlength="60" placeholder="${t('اسمك أو اسمك المستعار', 'Your name or nickname')}" required></div>` : ''}<div class="form-field"><label for="email">${t('البريد الإلكتروني', 'Email address')}</label><input id="email" name="email" type="email" dir="ltr" autocomplete="email" maxlength="254" placeholder="you@example.com" required></div><div class="form-field"><label for="password">${t('كلمة المرور', 'Password')}</label><div class="password-field"><input id="password" name="password" type="password" dir="ltr" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="10"' : ''} maxlength="128" placeholder="${t('كلمة مرورك الخاصة', 'Your own little secret')}" aria-describedby="${signup ? 'password-help' : 'auth-error'}" required><button type="button" data-toggle-password="password" aria-label="${t('إظهار كلمة المرور', 'Show password')}" aria-pressed="false">${icon('eye')}</button></div>${signup ? `<div class="password-strength" id="password-strength" data-strength="0"><span></span><span></span><span></span><span></span></div><small id="password-help">${t('١٠ أحرف على الأقل. عبارة طويلة وفريدة أفضل.', 'At least 10 characters. A long, unique passphrase is best.')}</small>` : ''}</div>${signup ? `<div class="form-field"><label for="confirm-password">${t('تأكيد كلمة المرور', 'One more time')}</label><div class="password-field"><input id="confirm-password" name="confirm" type="password" dir="ltr" autocomplete="new-password" placeholder="${t('أعد كتابة كلمة المرور', 'Confirm your password')}" required><button type="button" data-toggle-password="confirm-password" aria-label="${t('إظهار تأكيد كلمة المرور', 'Show password confirmation')}" aria-pressed="false">${icon('eye')}</button></div></div><label class="consent-label"><input type="checkbox" name="privacy" required><span>${t('قرأت وفهمت', 'I have read and understood the')} <a href="privacy.html" target="_blank" rel="noopener">${t('سياسة الخصوصية', 'privacy policy')}</a>.</span></label>` : ''}<div class="form-error" id="auth-error" role="alert" hidden></div><button class="button button-primary auth-submit" type="submit">${signup ? t('أنشئ مساحتي', 'Create my space') : t('هيا، لنكمل الرحلة', 'Let me in')}${arrow()}</button></form><p class="auth-switch">${signup ? t('لديك حساب بالفعل؟', 'Already part of the community?') : t('أول مرة هنا؟', 'New around here?')} <a href="${signup ? 'login.html' : 'signup.html'}">${signup ? t('سجّل الدخول', 'Log in') : t('أنشئ حسابك المجاني', 'Create your free account')}</a></p><div class="auth-privacy">${icon('lock')}${t('كلمة مرورك محمية. مساحتك ملكك.', 'Your password is protected. Your space is yours.')}</div></div></section>`;
}
const checklist = () => [
  ['privacy', t('راجعت إعدادات الخصوصية', 'I checked my privacy settings'), t('اختر من يرى منشوراتك ومن يستطيع التواصل معك.', 'Choose who can see your posts and get in touch.')],
  ['password', t('حميت حساباتي', 'I gave my accounts some extra protection'), t('كلمات مرور فريدة وتحقق بخطوتين متى أمكن.', 'Unique passwords and two-step verification where available.')],
  ['report', t('تعلمت الحظر والإبلاغ', 'I know how to block and report'), t('اعرف مكان أدوات الإبلاغ في تطبيقاتك المفضلة.', 'Find the reporting tools in your favourite apps.')],
  ['trusted', t('اخترت شخصًا أثق به', 'I know who I can turn to'), t('صديق داعم، فرد من العائلة، أو معلم موثوق.', 'A supportive friend, family member, or trusted teacher.')],
];
function dashboard() {
  if (staticPreview) return staticAccountNotice();
  if (!user) return `${pageHeading(t('مساحتك الخاصة', 'YOUR PERSONAL SPACE'), t('لحظة واحدة…', 'One little moment…'), t('نجهّز مساحتك.', 'Getting your space ready.'))}<div class="container" id="dashboard-status" role="status"></div>`;
  return `${pageHeading(t('شيء صغير، كل يوم', 'A LITTLE GROWTH, EVERY DAY'), `${t('أهلًا،', 'Hey,')} <span class="purple-text">${escapeHTML(user.name)}.</span>`, t('هذه مساحتك. كل خطوة صغيرة تصنع فرقًا.', 'This is your space. Every little step counts.'))}<section class="container section-block dashboard-section"><div class="dashboard-stats"><article class="stat-card"><span class="icon-box purple">${icon('bookmark')}</span><div><strong id="saved-count">${progress.saved.length}</strong><span>${t('موارد محفوظة', 'Saved resources')}</span></div></article><article class="stat-card"><span class="icon-box green">${icon('shield')}</span><div><strong id="check-count">${progress.checklist.length} / 4</strong><span>${t('خطوات نحو الأمان', 'Steps towards safety')}</span></div></article><article class="stat-card"><span class="icon-box peach">${icon('game')}</span><div><strong>${progress.quiz === null ? '—' : `${progress.quiz} / 5`}</strong><span>${t('أفضل نتيجة في التحدي', 'Your best challenge score')}</span></div></article></div><div class="dashboard-columns"><section class="checklist-panel"><span class="eyebrow">${t('ابدأ بخطوة بسيطة', 'YOUR LITTLE SAFETY CHECKLIST')}</span><h2>${t('نسخة أكثر أمانًا منك.', 'A more confident you.')}</h2><p>${t('ضع علامة على الخطوات التي أنجزتها. تقدمك يُحفظ تلقائيًا.', 'Check off the things you’ve done. Your progress saves automatically.')}</p><div class="checklist-items">${checklist().map(([id, title, description]) => `<label class="checklist-item"><input type="checkbox" data-checklist="${id}" ${progress.checklist.includes(id) ? 'checked' : ''}><span><b>${title}</b><small>${description}</small></span></label>`).join('')}</div></section><aside class="dashboard-challenge"><span class="challenge-star">✳</span><span class="eyebrow">${t('لديك ٣ دقائق؟', 'GOT THREE MINUTES?')}</span><h2>${t('اختبر بطلك<br>الرقمي الداخلي.', 'Meet your inner<br>digital superhero.')}</h2><p>${t('خمسة أسئلة. أفكار جديدة. وثقة أكبر.', 'Five questions. A few fresh ideas. A little more confidence.')}</p>${button(t('ابدأ التحدّي', 'Take the challenge'), 'interactive.html#quiz', 'dark')}</aside></div><div class="section-heading"><div><span class="eyebrow">${t('للعودة إليها لاحقًا', 'GOOD THINGS TO COME BACK TO')}</span><h2>${t('مكتبتك الصغيرة.', 'Your little library.')}</h2></div><a href="resources.html" class="text-link">${t('استكشف المزيد', 'Find something new')}${arrow()}</a></div><div class="resources-grid" id="saved-resources">${savedResources()}</div></section>`;
}
function savedResources() {
  return progress.saved.length ? resources().filter(r => progress.saved.includes(r.id)).map(resourceCard).join('') : `<div class="empty-state">${icon('bookmark')}<h3>${t('مكان لأشياء تستحق العودة.', 'A place for the good stuff.')}</h3><p>${t('اضغط على علامة الحفظ بجانب أي مورد وسيظهر هنا.', 'Tap the bookmark on any resource, and it’ll be waiting here for you.')}</p><a class="text-link" href="resources.html">${t('اكتشف أول مورد', 'Find your first resource')}${arrow()}</a></div>`;
}
function privacy() {
  if (staticPreview) return staticPrivacy();
  return `${pageHeading(t('ببساطة ووضوح', 'PLAIN AND SIMPLE'), t('خصوصيتك<br><span class="purple-text">تستحق الاحترام.</span>', 'Your privacy<br><span class="purple-text">deserves respect.</span>'), t('هذا ما يحفظه أمان، ولماذا.', 'Here’s what Aman stores, and why.'))}<article class="container prose section-block"><h2>${t('بيانات حسابك', 'Your account information')}</h2><p>${t('عندما تنشئ حسابًا، نحفظ اسمك الذي تختاره وبريدك الإلكتروني ونسخة مشتقة آمنة من كلمة مرورك. يمكنك استخدام اسم مستعار. لا نحفظ كلمة المرور كنص مقروء.', 'When you create an account, we store your chosen name, email address, and a securely derived password hash. You can use a nickname. Your password is never stored as readable text.')}</p><h2>${t('تقدمك واختياراتك', 'Your progress and preferences')}</h2><p>${t('نحفظ الموارد التي تختارها وقائمة الأمان وأفضل نتيجة في الاختبار في حسابك على الخادم. نحفظ تفضيل اللغة في متصفحك. ملف تعريف ارتباط ضروري يحافظ على جلسة دخولك لمدة تصل إلى سبعة أيام، وينتهي عند تسجيل الخروج.', 'Your bookmarked resources, safety checklist, and best quiz score are saved to your account on the server. Your language preference stays in your browser. A necessary session cookie keeps you signed in for up to seven days and is cleared when you log out.')}</p><h2>${t('توبي واستوديو المالك', 'Tobi and the owner studio')}</h2><p>${t('تُحفظ إعدادات اللعبة وهوية المالك وأفضل نتائج مهمة الأمان في قاعدة بيانات الموقع. تبقى محادثات توبي في الصفحة الحالية ولا يحفظها الموقع في قاعدة البيانات. إذا فعّل المالك OpenAI، تُرسل رسائلك وآخر سياق من المحادثة إلى OpenAI عند استخدام AI. يمكن للمالك إتاحته لكل الزوار دون تسجيل دخول أو للأعضاء فقط. نستخدم ملف تعريف ارتباط ضروري للزائر لمدة تصل إلى سنة لتطبيق حدود الاستخدام، ونحفظ عدادات يومية بمعرّفات مشتقة من الزائر وشبكة الإنترنت دون عنوان IP خام أو نص المحادثات. تُحذف عدادات الأيام السابقة عند الطلب التالي على AI. المفتاح الذي تضيفه من الاستوديو يُحفظ مشفّرًا على الخادم ولا يُعاد إرساله للمتصفح.', 'Game settings, the owner identity, and account Safety Quest scores are stored in the site database. Tobi conversations stay in the current page and are not saved to the database. If the owner enables OpenAI, messages and recent conversation context are sent to OpenAI when you use AI. The owner may allow all visitors without sign-in or limit access to members. An essential visitor cookie lasts up to a year to enforce usage limits. Daily counters use derived visitor and network identifiers without raw IP addresses or conversation text. Previous days’ counters are deleted on the next AI request. Keys added in Tobi Studio are encrypted on the server and are never returned to the browser.')}</p><h2>${t('خدمات خارجية', 'External services')}</h2><p>${t('نستخدم خطوط Google لعرض الموقع، وقد يرسل تحميلها عنوان IP وبيانات المتصفح إلى Google. عند فتح دليل أو لعبة خارج الموقع، تسري سياسة خصوصية ذلك الموقع. لا نستخدم أدوات تحليلات أو إعلانات.', 'We use Google Fonts for typography. Loading them may send your IP address and browser information to Google. When you open an external guide or game, that website’s privacy policy applies. We don’t use analytics or advertising tools.')}</p><h2>${t('الدعم والمعلومات الحساسة', 'Support and sensitive information')}</h2><p>${t('أمان مشروع توعوي، ولا يستقبل بلاغات أو يقدم خدمة طوارئ أو دردشة مباشرة. لا ترسل صورًا خاصة أو تفاصيل حساسة إلى الموقع. إذا احتجت مساعدة، تحدث مع شخص موثوق أو جهة دعم محلية مناسبة.', 'Aman is an educational project. It does not receive incident reports or provide an emergency service or live counselling. Don’t send private photos or sensitive incident details to this website. Reach out to a trusted person or an appropriate local support service when you need help.')}</p><h2>${t('إدارة البيانات', 'Managing data')}</h2><p>${t('يمكنك إزالة الموارد المحفوظة وإلغاء خطوات القائمة من مساحتك. لا توجد حاليًا واجهة لحذف الحساب؛ يستطيع مشغّل هذه النسخة إدارة بيانات الحساب مباشرة في قاعدة البيانات. الحسابات تخص الخادم الذي تستخدمه.', 'You can remove saved resources and uncheck checklist items in your space. There is currently no account-deletion interface; the operator of this instance can manage account data directly in the database. Accounts belong to the server you are using.')}</p></article>`;
}
function supportSteps() {
  return [
    [t('توقف، وخذ نفسًا', 'Pause. Take a breath.'), t('لا ترد بالإساءة. ابتعد قليلًا عن الشاشة إذا احتجت.', 'You don’t have to respond. Step away from the screen for a moment if it helps.')],
    [t('احتفظ بالدليل', 'Keep the evidence.'), t('احفظ الرسائل أو لقطات الشاشة مع التاريخ دون إعادة نشرها.', 'Save messages or screenshots with the date. Avoid reposting harmful content.')],
    [t('احظر وأبلغ', 'Block and report.'), t('استخدم أدوات الحظر والإبلاغ في المنصة، وراجع خصوصيتك.', 'Use the platform’s blocking and reporting tools, and review your privacy settings.')],
    [t('تحدث إلى شخص موثوق', 'Let someone in.'), t('تواصل مع شخص بالغ موثوق، أو معلم، أو فرد من العائلة. لست وحدك.', 'Talk to a trusted adult, teacher, or family member. You don’t have to do this alone.')],
  ];
}
function supportDialog() {
  return `<dialog id="support-dialog" aria-labelledby="support-title"><button class="dialog-close" type="button" data-close-dialog aria-label="${t('إغلاق', 'Close')}">${icon('close')}</button><span class="icon-box purple">${icon('heart')}</span><span class="eyebrow">${t('أنت لست وحدك', 'YOU ARE NOT ALONE')}</span><h2 id="support-title">${t('لنأخذها خطوة بخطوة.', 'Let’s take it one step at a time.')}</h2><p>${t('ما حدث ليس خطأك. هذه خطوات يمكنك البدء بها الآن.', 'What happened isn’t your fault. Here are a few things you can do right now.')}</p><ol class="support-steps">${supportSteps().map(([title, description]) => `<li><b>${title}</b><p>${description}</p></li>`).join('')}</ol><div class="support-emergency">${t('إذا كنت في خطر فوري، تواصل مع الطوارئ المحلية أو شخص بالغ موثوق الآن. أمان موقع توعوي وليس خدمة طوارئ.', 'If you are in immediate danger, contact your local emergency services or a trusted adult now. Aman is an educational website, not an emergency service.')}</div><a class="button button-primary" href="resources.html">${t('موارد تساعدك', 'Find helpful resources')}${arrow()}</a></dialog>`;
}
function localOpenNotice() {
  const route = page === 'home' ? 'index.html' : page + '.html';
  return `<aside class="container local-open-notice"><div><strong>${t('أنت فاتح نسخة الملف.', 'You’re viewing the local file.')}</strong><p>${t('المجسّم والألعاب المجانية يشتغلوا هنا. لتسجيل الدخول وتوبي AI، افتح Open Aman.cmd من فولدر الموقع بدبل كليك.', 'The 3D scene and free activities work here. For sign-in and Tobi AI, double-click Open Aman.cmd in the website folder.')}</p></div><a href="http://127.0.0.1:3000/${route}">${t('افتح الموقع لو شغّال', 'Open the running site')}${arrow()}</a></aside>`;
}
function staticAccountNotice() {
  return `${pageHeading(t('متاح للجميع', 'OPEN TO EVERYONE'), t('العب واستكشف<br><span class="purple-text">من غير حساب.</span>', 'Play and explore.<br><span class="purple-text">No account needed.</span>'), t('تسجيل الدخول وحفظ التقدم بحساب مش متاحين على الرابط ده. تقدر تستخدم الأدلة والألعاب ودفتر توبي المجاني.', 'Sign-in and account progress are unavailable on this link. You can still explore the guides, games, and Tobi’s free notebook.'))}<section class="container section-block"><div class="hero-buttons">${button(t('تعلّم والعب', 'Learn & play'), 'interactive.html')}${button(t('قابل توبي', 'Meet Tobi'), 'tobi.html', 'white')}</div></section>`;
}
function staticPrivacy() {
  return `${pageHeading(t('ببساطة ووضوح', 'PLAIN AND SIMPLE'), t('خصوصيتك<br><span class="purple-text">تستحق الاحترام.</span>', 'Your privacy<br><span class="purple-text">deserves respect.</span>'), t('معلومات عن النسخة العامة من أمان.', 'About this public version of Aman.'))}<section class="container section-block"><article class="privacy-content"><h2>${t('بيانات على جهازك', 'On your device')}</h2><p>${t('متصفحك بيحفظ اللغة وتفضيلات العرض وأفضل نتيجة لتوبي. المحادثة بتفضل في الصفحة الحالية. النسخة دي مش بتجمع كلمات مرور أو تنشئ حسابات، ومش بتبعت الدردشة لخدمة AI.', 'Your browser remembers your language, display preferences, and Tobi’s best score. Conversation text stays in the current page. This version does not collect passwords, create accounts, or send chats to an AI service.')}</p><h2>${t('خدمات خارجية', 'Other services')}</h2><p>${t('الموقع مستضاف على GitHub Pages وبيستخدم Google Fonts. لعبة أنقذ العالم بتفتح على itch.io، وروابط الأدلة بتفتح مواقع الجهات الناشرة. الخدمات دي لها سياسات الخصوصية الخاصة بها.', 'GitHub Pages hosts this site, which uses Google Fonts. Save the World opens on itch.io, and resource links open their publishers’ websites. Those services have their own privacy policies.')}</p><p>${t('تقدر تمسح التفضيلات المحفوظة من إعدادات بيانات المواقع في متصفحك.', 'You can clear saved preferences through your browser’s site-data settings.')}</p></article></section>`;
}
function render() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  const names = { home: t('مساحتك الرقمية الآمنة', 'A kinder digital world'), about: t('افهم التنمر', 'Understand bullying'), resources: t('الموارد', 'Resources'), interactive: t('تعلّم وتفاعل', 'Learn & play'), login: t('تسجيل الدخول', 'Log in'), signup: t('إنشاء حساب', 'Sign up'), dashboard: t('مساحتي', 'My space'), privacy: t('الخصوصية', 'Privacy') };
  document.title = `${t('أمان', 'Aman')} — ${names[page]}`;
  const pages = { home, about, resources: resourcesPage, interactive, login: () => auth(false), signup: () => auth(true), dashboard, privacy };
  $('#app').innerHTML = `${header()}<main id="main" tabindex="-1">${filePreview ? localOpenNotice() : ''}${(pages[page] || home)()}</main>${footer()}${supportDialog()}<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  if (page === 'resources') updateResourceResults();
  if (staticPreview) {
    $$('[data-save]').forEach(element => element.remove());
    const quizNote = $('.quiz-intro small');
    if (quizNote) quizNote.textContent = t('متاح للجميع من غير حساب.', 'Open to everyone. No account needed.');
  }
  bindInteractions();
  observeReveals();
}
function observeReveals() {
  observer?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), { threshold: 0.06 });
  $$('.reveal').forEach(element => { element.classList.add('will-reveal'); observer.observe(element); });
}
let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 4200);
}
const errors = () => ({
  invalid_credentials: t('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'That email and password don’t match. Please try again.'),
  email_exists: t('هذا البريد مسجل بالفعل. جرّب تسجيل الدخول.', 'That email already has an account. Try logging in.'),
  invalid_fields: t('راجع بياناتك. يجب ألا تقل كلمة المرور الجديدة عن ١٠ أحرف.', 'Check your details. New passwords need at least 10 characters.'),
  too_many_attempts: t('محاولات كثيرة. انتظر ١٥ دقيقة ثم حاول مجددًا.', 'A few too many attempts. Please wait 15 minutes and try again.'),
  unauthorized: t('انتهت جلستك. سجّل الدخول مرة أخرى.', 'Your session has ended. Please log in again.'),
  offline: t('تعذر الاتصال. افتح الموقع من خادم أمان وحاول مجددًا.', 'We couldn’t connect. Open the site through the Aman server and try again.'),
  server_error: t('حدث خطأ. حاول مرة أخرى بعد قليل.', 'Something went wrong. Please try again in a moment.'),
});
async function api(url, options = {}) {
  if (filePreview || staticPreview) throw new Error('offline');
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); } catch { throw new Error('offline'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('offline'); }
  if (!response.ok) throw new Error(result.error || 'server_error');
  return result;
}
function friendlyError(error) { return errors()[error.message] || errors().server_error; }
function safeNext() {
  const next = new URLSearchParams(location.search).get('next');
  return ['dashboard.html', 'resources.html', 'interactive.html', 'tobi.html', 'tobi-studio.html'].includes(next) ? next : 'dashboard.html';
}
function bindInteractions() {
  $('[data-kindness-next]')?.addEventListener('click', () => {
    kindnessIndex = (kindnessIndex + 1) % kindnessNotes().length;
    const [note, caption] = kindnessNotes()[kindnessIndex];
    $('[data-kindness-note]').textContent = note;
    $('[data-kindness-caption]').textContent = caption;
    const card = $('[data-kindness-card]');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.getAnimations().forEach(animation => animation.cancel());
      card.animate([
        { transform: 'perspective(1000px) rotateY(0deg) rotate(-2deg)' },
        { transform: 'perspective(1000px) rotateY(-12deg) rotate(-1deg)', offset: .4 },
        { transform: 'perspective(1000px) rotateY(0deg) rotate(-2deg)' }
      ], { duration: 440, easing: 'ease-out' });
    }
  });
  $('[data-language]')?.addEventListener('click', () => {
    language = language === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('aman-language', language); } catch {}
    render();
    $('[data-language]')?.focus();
  });
  const menu = $('.menu-button');
  menu?.addEventListener('click', () => { const expanded = menu.getAttribute('aria-expanded') === 'true'; menu.setAttribute('aria-expanded', String(!expanded)); $('#main-nav').classList.toggle('open', !expanded); menu.innerHTML = icon(expanded ? 'menu' : 'close'); });
  bindAccountNav();
  const dialog = $('#support-dialog');
  $$('[data-support]').forEach(btn => btn.addEventListener('click', () => dialog.showModal()));
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  $$('[data-toggle-password]').forEach(btn => btn.addEventListener('click', () => { const input = document.getElementById(btn.dataset.togglePassword); const shown = input.type === 'password'; input.type = shown ? 'text' : 'password'; btn.innerHTML = icon(shown ? 'eyeOff' : 'eye'); btn.setAttribute('aria-pressed', String(shown)); btn.setAttribute('aria-label', shown ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')); }));
  $('#password')?.addEventListener('input', event => { const meter = $('#password-strength'); if (!meter) return; const value = event.target.value; meter.dataset.strength = value.length === 0 ? 0 : value.length < 10 ? 1 : value.length < 14 ? 2 : value.length < 18 ? 3 : 4; });
  $('#auth-form')?.addEventListener('submit', submitAuth);
  $('#confirm-password')?.addEventListener('input', event => event.target.setCustomValidity(''));
  $$('[data-filter]').forEach(btn => btn.addEventListener('click', () => { resourceFilter = btn.dataset.filter; $$('[data-filter]').forEach(tab => { tab.classList.toggle('selected', tab === btn); tab.setAttribute('aria-pressed', String(tab === btn)); }); updateResourceResults(); }));
  $('#resource-search')?.addEventListener('input', event => { resourceSearch = event.target.value; updateResourceResults(); });
  bindSaveButtons();
  bindQuiz();
  $$('[data-checklist]').forEach(input => input.addEventListener('change', async () => {
    const selection = $$('[data-checklist]:checked').map(el => el.dataset.checklist);
    $$('[data-checklist]').forEach(el => el.disabled = true);
    try { progress = await api('/api/progress', { method: 'PUT', body: JSON.stringify({ checklist: selection }) }); $('#check-count').textContent = `${progress.checklist.length} / 4`; toast(t('خطوة رائعة! حُفظ تقدمك.', 'A little step forward. Progress saved.')); }
    catch (error) { input.checked = !input.checked; toast(friendlyError(error)); }
    finally { $$('[data-checklist]').forEach(el => el.disabled = false); }
  }));
}
function bindAccountNav() {
  $('[data-logout]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.href = 'index.html'; }
    catch (error) { toast(friendlyError(error)); $('[data-logout]').disabled = false; }
  });
}
async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const signup = form.dataset.mode === 'signup';
  const data = new FormData(form);
  const errorBox = $('#auth-error');
  errorBox.hidden = true;
  if (signup && data.get('password') !== data.get('confirm')) { errorBox.textContent = t('كلمتا المرور غير متطابقتين.', 'Those passwords don’t match yet.'); errorBox.hidden = false; $('#confirm-password').focus(); return; }
  const submit = $('button[type="submit"]', form);
  const label = submit.innerHTML;
  submit.disabled = true;
  submit.innerHTML = `<span class="spinner"></span>${t('لحظة صغيرة…', 'One little moment…')}`;
  try {
    await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify({ name: data.get('name'), email: data.get('email'), password: data.get('password') }) });
    location.href = safeNext();
  } catch (error) { errorBox.textContent = friendlyError(error); errorBox.hidden = false; submit.disabled = false; submit.innerHTML = label; }
}
function updateResourceResults() {
  const result = resources().filter(r => (resourceFilter === 'all' || r.category === resourceFilter) && `${r.name} ${r.description} ${r.logo}`.toLocaleLowerCase().includes(resourceSearch.trim().toLocaleLowerCase()));
  $('#resource-results').innerHTML = result.length ? result.map(resourceCard).join('') : `<div class="empty-state">${icon('search')}<h3>${t('لم نجد موردًا بهذه الكلمات.', 'Nothing here just yet.')}</h3><p>${t('جرّب كلمات أخرى أو اختر «الكل».', 'Try a different search, or select All resources.')}</p><button class="button button-white" type="button" id="clear-search">${t('مسح البحث والتصفية', 'Clear search & filters')}</button></div>`;
  $('#resource-count').textContent = t(`${result.length} موارد للبدء`, `${result.length} resources to explore`);
  $('#clear-search')?.addEventListener('click', () => { resourceFilter = 'all'; resourceSearch = ''; $('#resource-search').value = ''; $$('[data-filter]').forEach(tab => { tab.classList.toggle('selected', tab.dataset.filter === 'all'); tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all')); }); updateResourceResults(); $('#resource-search').focus(); });
  bindSaveButtons();
  observeReveals();
}
function bindSaveButtons() {
  if (staticPreview) { $$('[data-save]').forEach(element => element.remove()); return; }
  $$('[data-save]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async () => {
      if (!user) { if (!sessionAvailable) { toast(errors().offline); return; } location.href = `login.html?next=${page === 'home' ? 'resources.html' : `${page}.html`}`; return; }
      const id = btn.dataset.save;
      const saved = progress.saved.includes(id) ? progress.saved.filter(item => item !== id) : [...progress.saved, id];
      $$('[data-save]').forEach(el => el.disabled = true);
      try {
        progress = await api('/api/progress', { method: 'PUT', body: JSON.stringify({ saved }) });
        $$(`[data-save="${id}"]`).forEach(el => { el.classList.toggle('saved', progress.saved.includes(id)); el.setAttribute('aria-pressed', String(progress.saved.includes(id))); });
        if (page === 'dashboard') { $('#saved-count').textContent = progress.saved.length; $('#saved-resources').innerHTML = savedResources(); bindSaveButtons(); observeReveals(); }
        toast(progress.saved.includes(id) ? t('حُفظ في مكتبتك الصغيرة.', 'Tucked away in your little library.') : t('أُزيل من الموارد المحفوظة.', 'Removed from your saved resources.'));
      } catch (error) { toast(friendlyError(error)); }
      finally { $$('[data-save]').forEach(el => el.disabled = false); }
    });
  });
}
function updateQuiz(focus = true) { $('#quiz-panel').innerHTML = quizContent(); bindQuiz(); if (focus) $('.quiz-question, .quiz-result')?.focus({ preventScroll: true }); }
function bindQuiz() {
  $('[data-start-quiz]')?.addEventListener('click', () => { quizStarted = true; quizIndex = 0; quizAnswers = []; updateQuiz(); });
  $('[data-restart-quiz]')?.addEventListener('click', () => { quizStarted = true; quizIndex = 0; quizAnswers = []; updateQuiz(); });
  $$('[data-answer]').forEach(btn => btn.addEventListener('click', () => { quizAnswers[quizIndex] = Number(btn.dataset.answer); updateQuiz(false); $('[data-next-question]').focus({ preventScroll: true }); }));
  $('[data-next-question]')?.addEventListener('click', async () => { quizIndex++; updateQuiz(); if (quizIndex === questions().length) await saveQuiz(); });
}
async function saveQuiz() {
  const score = quizAnswers.filter((answer, i) => answer === questions()[i].correct).length;
  if (!user) { try { sessionStorage.setItem('aman-pending-score', String(score)); } catch {} return; }
  try {
    progress = await api('/api/progress', { method: 'PUT', body: JSON.stringify({ quiz: score }) });
    if ($('#quiz-save-note')) $('#quiz-save-note').textContent = t('حُفظت أفضل نتيجتك في مساحتك.', 'Your best score is saved in your space.');
  } catch (error) { if ($('#quiz-save-note')) $('#quiz-save-note').textContent = friendlyError(error); }
}

document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#main-nav')?.classList.contains('open')) { $('.menu-button').click(); $('.menu-button').focus(); } });
render();
async function initializeSession() {
  if (filePreview || staticPreview) { sessionAvailable = false; return; }
  try {
    ({ user } = await api('/api/auth/session'));
    if (user) {
      progress = await api('/api/progress');
      let pending;
      try { pending = sessionStorage.getItem('aman-pending-score'); } catch {}
      if (pending !== null && pending !== undefined && /^[0-5]$/.test(pending)) {
        progress = await api('/api/progress', { method: 'PUT', body: JSON.stringify({ quiz: Number(pending) }) });
        try { sessionStorage.removeItem('aman-pending-score'); } catch {}
      }
    }
    if (page === 'dashboard') { if (!user) location.replace('login.html?next=dashboard.html'); else render(); }
    else if ((page === 'login' || page === 'signup') && user) location.replace(safeNext());
    else {
      $('#account-nav').innerHTML = accountNav();
      bindAccountNav();
      $$('[data-save]').forEach(btn => { const saved = progress.saved.includes(btn.dataset.save); btn.classList.toggle('saved', saved); btn.setAttribute('aria-pressed', String(saved)); });
    }
  } catch {
    sessionAvailable = false;
    if (page === 'dashboard') $('#dashboard-status').innerHTML = `<div class="empty-state"><h2>${t('تعذر تحميل مساحتك.', 'We couldn’t load your space.')}</h2><p>${errors().offline}</p><a class="button button-primary" href="dashboard.html">${t('حاول مجددًا', 'Try again')}</a></div>`;
  }
}
initializeSession();
