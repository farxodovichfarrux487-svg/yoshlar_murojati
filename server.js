require('dotenv').config();
const express = require('express'), session = require('express-session'), bcrypt = require('bcrypt');
const Database = require('better-sqlite3'), multer = require('multer');
const path = require('path'), fs = require('fs'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const DATA = path.join(__dirname, 'data'), UP = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(UP, { recursive: true });

/* ---------- Baza ---------- */
const db = new Database(path.join(DATA, 'portal.db'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, fullname TEXT NOT NULL, position TEXT DEFAULT '', username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('admin','hokim','org')), org TEXT DEFAULT '', tg_username TEXT DEFAULT '',
  tg_chat_id TEXT, tg_code TEXT, tg_code_exp INTEGER, must_change INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS meetings(id INTEGER PRIMARY KEY, date TEXT NOT NULL, place TEXT NOT NULL, signer TEXT NOT NULL, agenda TEXT NOT NULL, decisions TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appeals(id INTEGER PRIMARY KEY, number TEXT UNIQUE, meeting_id INTEGER REFERENCES meetings(id), date TEXT NOT NULL,
  name TEXT NOT NULL, phone TEXT NOT NULL, mahalla TEXT NOT NULL, text TEXT NOT NULL, org TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  deadline TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Yangi', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS responses(id INTEGER PRIMARY KEY, appeal_id INTEGER NOT NULL REFERENCES appeals(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL, file TEXT, file_name TEXT, state TEXT NOT NULL DEFAULT 'pending', admin_comment TEXT, created_at INTEGER NOT NULL, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, appeal_id INTEGER NOT NULL REFERENCES appeals(id) ON DELETE CASCADE, user_id INTEGER, action TEXT NOT NULL, note TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tg_log(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER, to_name TEXT, text TEXT, ok INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS reminders(appeal_id INTEGER, day TEXT, PRIMARY KEY(appeal_id, day));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);

-- Test savollari jadvali
CREATE TABLE IF NOT EXISTS quiz_questions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  text TEXT,
  options TEXT,
  correct_answer TEXT,
  explanation TEXT
);
`);

const addCol = (t, c, d) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); };
['last_name', 'first_name', 'middle_name', 'category', 'subject', 'note'].forEach(c => addCol('appeals', c, "TEXT DEFAULT ''"));
['number', 'file', 'file_name'].forEach(c => addCol('meetings', c, 'TEXT'));
const CATS = ['Doimiy ishga joylashtirish', 'Kredit ajratish', 'Yoshlar daftariga kiritish', "Kasb-hunarga o'qitish", "Migratsiyaga jo'natish", 'Davolanish', 'Asbob-uskuna ajratish', 'Boshqa masalalar'];
const normPhone = v => { const d = String(v || '').replace(/\D/g, ''); return /^998\d{9}$/.test(d) ? `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}` : null; };

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const daysLeft = s => Math.round((new Date(s + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
const h = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const OPEN = ['Yangi', 'Jarayonda', 'Qayta ishlash kerak'];
const hist = (aid, uid, action, note = '') => db.prepare('INSERT INTO history(appeal_id,user_id,action,note,at) VALUES(?,?,?,?,?)').run(aid, uid, action, note, Date.now());

function seed() {
  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
    const ins = db.prepare('INSERT INTO users(fullname,position,username,password_hash,role,org) VALUES(?,?,?,?,?,?)');
    const mk = (n, p, u, pw, r, o) => ins.run(n, p, u, bcrypt.hashSync(pw, 10), r, o).lastInsertRowid;
    mk('Tizim boshqaruvchisi', 'Super admin', 'admin', 'Admin123!', 'admin', 'Tuman Hokimligi');
    mk('N. Alimov', 'Tuman hokimi', 'hokim', 'Hokim123!', 'hokim', 'Tuman Hokimligi');
    const b = mk('B. Karimov', "Bandlik bo'limi boshlig'i", 'bandlik', 'Bandlik123!', 'org', "Tuman Bandlik Bo'limi");
    const k = mk('S. Sobirov', 'Filial boshqaruvchisi', 'bank', 'Bank12345!', 'org', 'ATB Xalq Banki Tuman Filiali');
    mk('D. Tursunova', 'Agentlik rahbari', 'agent', 'Agent123!', 'org', 'Yoshlar Ishlari Agentligi');
    mk('Sh. Fayziyev', "Birlashma boshlig'i", 'med', 'Med12345!', 'org', 'Tuman Tibbiyot Birlashmasi');
    const m = db.prepare("INSERT INTO meetings(date,place,signer,agenda,decisions,number) VALUES(?,?,?,?,?,?)").run(plus(-6), '', '', '', '', '1').lastInsertRowid;
    const a = db.prepare('INSERT INTO appeals(number,meeting_id,date,name,last_name,first_name,middle_name,phone,mahalla,category,subject,text,org,user_id,deadline,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const yr = new Date().getFullYear();
    a.run(`MUR-${yr}-0001`, m, plus(-6), "Toshpulatov Jasurbek Ahmadjon o'g'li", 'Toshpulatov', 'Jasurbek', "Ahmadjon o'g'li", '+998 94 444 77 88', 'Birlik MFY', 'Doimiy ishga joylashtirish', 'Doimiy ish bilan ta\'minlash', "Doimiy ishga joylashish va kasb-hunar yo'llanmasi so'raydi.", "Tuman Bandlik Bo'limi", b, plus(8), 'Yangi', Date.now());
    a.run(`MUR-${yr}-0002`, m, plus(-6), "Umarova Madina Karim qizi", 'Umarova', 'Madina', 'Karim qizi', '+998 90 111 22 33', 'Gulzor MFY', 'Kredit ajratish', 'Tikuvchilik sexi uchun kredit', "Tikuvchilik sexi ochish uchun imtiyozli 30 mln so'm kredit so'raydi.", 'ATB Xalq Banki Tuman Filiali', k, plus(3), 'Yangi', Date.now());
  }

  // 15 ta test savollarini bazaga kiritish (agar oldin kiritilmagan bo'lsa)
  if (!db.prepare('SELECT COUNT(*) c FROM quiz_questions').get().c) {
    const qInsert = db.prepare('INSERT INTO quiz_questions(title, text, options, correct_answer, explanation) VALUES(@title, @text, @options, @correctAnswer, @explanation)');
    const sampleQuestions = [
      {
        title: "Savol 7",
        text: "Jabrlangan shaxs murojaatini qaytarib oldi va ko‘rib chiqishni tugatishni so‘radi. Materiallarda jinsiy majburlash va xizmat jihatidan qaramlik alomatlari mavjud. Qanday yo‘l tutish lozim?",
        options: JSON.stringify([
          { key: "A", text: "Masalani hal etishni tashkilot rahbarining ixtiyoriga qoldirish" },
          { key: "B", text: "Ko‘rib chiqishni davom ettirish: xavfsizlikka tahdid, zo‘ravonlik, jinsiy majburlash, tizimli qoidabuzarlik, mansab vakolatini suiiste’mol qilish, ta’qib yoki boshqa shaxslarga xavf mavjud bo‘lsa, murojaatni qaytarib olish ko‘rib chiqishni tugatmaydi" },
          { key: "D", text: "Ko‘rib chiqishni tugatish, biroq jamoa o‘rtasida umumiy so‘rov o‘tkazish" },
          { key: "E", text: "Jabrlangan shaxsning pozitsiyasi hal qiluvchi ahamiyatga ega bo‘lgani uchun ko‘rib chiqishni tugatish" }
        ]),
        correctAnswer: "B",
        explanation: "Xavfsizlikka tahdid, zo‘ravonlik, jinsiy majburlash yoki mansab vakolatini suiiste’mol qilish mavjud bo‘lsa, murojaatni qaytarib olish ko‘rib chiqishni to‘xtatmaydi."
      },
      {
        title: "Savol 8",
        text: "Tomonlarni «ajratish» maqsadida jabrlangan shaxsni vaqtinchalik himoya chorasi sifatida boshqa bo‘linmadagi kamroq haq to‘lanadigan lavozimga o‘tkazish taklif qilinmoqda. Ushbu taklifni baholang.",
        options: JSON.stringify([
          { key: "A", text: "Chora vaqtinchalik bo‘lgani sababli unga yo‘l qo‘yiladi" },
          { key: "B", text: "Chora muddati o‘n ish kunidan oshmasa, unga yo‘l qo‘yiladi" },
          { key: "D", text: "Choraga yo‘l qo‘yilmaydi: vaqtinchalik choralar jabrlangan shaxsning holatini yomonlashtirmasligi kerak, uni lavozimidan pasaytirish va ish haqini kamaytirish taqiqlanadi" },
          { key: "E", text: "Bo‘linma rahbarining roziligi bilan choraga yo‘l qo‘yiladi" }
        ]),
        correctAnswer: "D",
        explanation: "Vaqtinchalik choralar jabrlangan shaxsning holatini yomonlashtirmasligi kerak, uni lavozimidan pasaytirish va ish haqini kamaytirish taqiqlanadi."
      },
      {
        title: "Savol 9",
        text: "Murojaatni ko‘rib chiqishni boshlab bo‘lgan vakolatli shaxs murojaat berilgan shaxsga xizmat jihatidan qaram ekanini aniqladi. U qanday yo‘l tutishi kerak?",
        options: JSON.stringify([
          { key: "A", text: "Ko‘rib chiqishni va materiallardan foydalanishni to‘xtatish, asosni portalda qayd etish hamda murojaatni vertikal tartibda ko‘rib chiqish uchun yuborilishini ta’minlash" },
          { key: "B", text: "Portalda qayd etmasdan, og‘zaki kelishuv asosida materiallarni hamkasbiga topshirish" },
          { key: "D", text: "Ko‘rib chiqish boshlanganligi sababli uni yakunlash va xulosada manfaatlar to‘qnashuvini ko‘rsatish" },
          { key: "E", text: "Tashkilot rahbarining ko‘rsatmasiga qadar ko‘rib chiqishni to‘xtatib turish" }
        ]),
        correctAnswer: "A",
        explanation: "Ko‘rib chiqish va materiallardan foydalanishni to‘xtatish, asosni portalda qayd etish hamda murojaatni vertikal tartibda ko‘rib chiqish uchun yuborilishini ta’minlash lozim."
      },
      {
        title: "Savol 10",
        text: "Xizmat jihatidan qaramlik, tahdid va jinsiy xususiyat alomatlari mavjud bo‘lmagan, og‘irlik darajasi past bir martalik noo‘rin fikr bildirish holati yuz berdi. Jabrlangan shaxs norasmiy hal etishga ixtiyoriy ravishda rozi bo‘ldi. Qaysi javob to‘g‘ri?",
        options: JSON.stringify([
          { key: "A", text: "Norasmiy hal etishga yo‘l qo‘yiladi; jabrlangan shaxs istalgan vaqtda uni to‘xtatib, murojaatni umumiy tartibda ko‘rib chiqishni talab qilishga haqli" },
          { key: "B", text: "Norasmiy hal etish tashkilotni murojaatni portalda ro‘yxatdan o‘tkazish majburiyatidan ozod qiladi" },
          { key: "D", text: "Norasmiy hal etish tomonlarning albatta yuzma-yuz uchrashuvini talab qiladi" },
          { key: "E", text: "Norasmiy hal etish boshlanganidan keyin umumiy tartibga qaytish mumkin emas" }
        ]),
        correctAnswer: "A",
        explanation: "Norasmiy hal etishga yo‘l qo‘yiladi; jabrlangan shaxs istalgan vaqtda uni to‘xtatib, murojaatni umumiy tartibda ko‘rib chiqishni talab qilishga haqli."
      },
      {
        title: "Savol 11",
        text: "Rahbar Hilolani xizmat safariga yubormadi va u bolalari bilan uyda qolishi kerakligini aytdi. Hilola portal orqali murojaat qildi, shundan so‘ng rahbar undan uzr so‘radi. Shu sababli Hilola masalani norasmiy tartibda hal qilish orqali yopdi. Ikki oy o‘tgach, Hilola uning mukofoti bo‘limdagi eng kam mukofot ekanini bildi. U rahbaridan sababini so‘radi. Rahbar bolalari sababli uning ish kunlari qisqartirilganini va u hammadan kam ishlashini aytdi. Bu murojaat uchun ta’qibmi yoki yo‘l qo‘yiladigan xatti-harakatmi?",
        options: JSON.stringify([
          { key: "A", text: "BUNGA YO‘L QO‘YILADI — Mukofotning kamligi Hilolani hayratga soldi..." },
          { key: "B", text: "BU — MUROJAAT UCHUN TA’QIB — Kichik yoshdagi bolalari bor ota-onalar uchun qisqartirilgan ish kuni Mehnat kodeksi bilan tartibga solinadi va xodimning mehnatga haq to‘lash bilan bog‘liq to‘lovlarga ta’sir qilmasligi kerak. Hilolaning rahbar xatti-harakatlari yuzasidan murojaat qilganidan keyin uning holati yomonlashganini hisobga olsak, bu ta’qib bo‘lishi mumkin." }
        ]),
        correctAnswer: "B",
        explanation: "Murojaat qilganidan keyin xodimning holati yomonlashgani (mukofotning asossiz kamaytirilishi) ta’qib belgisi hisoblanadi."
      },
      {
        title: "Savol 12",
        text: "Olim raxabarga Said benefitsiarlar ro‘yxatini tayyorlamaganini aytdi. Rahbar ish vaqtidan tashqari Saidga qo‘ng‘iroq qilib, unga baqirdi. Said telefonni qo‘yib qo‘ydi. Ertalab Said ro‘yxatni stol ustida qoldirgani, biroq tozalash vaqtida u tasodifan tashlab yuborilgani ma’lum bo‘ldi. Rahbar Saiddan uzr so‘radi. Qo‘ng‘iroq vaqtida rahbar to‘g‘ri yo‘l tutdimi?",
        options: JSON.stringify([
          { key: "A", text: "BU — XARASSMENT — Rahbar haq yoki nohaq bo‘lishidan qat’i nazar, bo‘ysunuvidagi xodimga baqirish mumkin emas..." },
          { key: "B", text: "BUNGA YO‘L QO‘YILADI — Rahbar vaziyatni aniqlab, uzr so‘ragan bo‘lsa, masala yopilgandek ko‘rinishi mumkin..." }
        ]),
        correctAnswer: "A",
        explanation: "Rahbar haq yoki nohaq bo‘lishidan qat’i nazar, bo‘ysunuvidagi xodimga ish vaqtidan tashqari qo‘ng‘iroq qilib baqirishga yo‘l qo‘yilmaydi."
      },
      {
        title: "Savol 13",
        text: "Qaydnomalarni payshanbagacha tuman xalq ta’limi bo‘limiga topshirish kerak edi. Juma kuni maktab direktori qaydnomalarni topshirmagan o‘qituvchilarni yig‘di. U: «Tayyorlanish uchun bir hafta vaqtingiz bor edi. Siz maktabni noqulay ahvolga solib qo‘ydingiz va mukofotdan mahrum bo‘lasiz. Bu muhokama qilinmaydi», — dedi. Direktor tomonidan bunday suhbat maqbulmi?",
        options: JSON.stringify([
          { key: "A", text: "BUNGA YO‘L QO‘YILADI — Direktor hujjatlarni belgilangan muddatda topshirishni talab qilishga haqli. E’tiroz faqat bajarilmagan ishga taalluqli va uni bajarmagan shaxslarga qaratilgan." },
          { key: "B", text: "BU — XARASSMENT — Suhbat yoqimsiz bo‘lishi va ayrimlar qarorni adolatsiz deb hisoblashi mumkin..." }
        ]),
        correctAnswer: "A",
        explanation: "Direktor hujjatlarni belgilangan muddatda topshirishni talab qilishga haqli. Qat’iy ohang qoidabuzarlik hisoblanmaydi."
      },
      {
        title: "Savol 14",
        text: "Oybek va Bobur xizmat safariga bordi. Kechqurun ovqat paytida Bobur o‘zini juda erkin tutib, shou-dastur xodimalarini o‘z xonasiga taklif qila boshladi. Oybek uni bir necha marta xonasiga olib ketishga urindi, biroq Bobur uning gapiga quloq solmadi. Ertalab Bobur hech narsani eslay olmadi. Oybek qanday yo‘l tutishi kerak?",
        options: JSON.stringify([
          { key: "A", text: "BOBURNING XATTI-HARAKATI HAQIDA XABAR BERISH — Oybek o‘z shaxsi oshkor etilmasligi uchun portal orqali anonim murojaat yuborishi mumkin..." },
          { key: "B", text: "BOBURDAN BOSHQA BUNDAY QILMASLIKNI SO‘RASH..." }
        ]),
        correctAnswer: "A",
        explanation: "Davlat xizmatchisining bunday xatti-harakatiga yo‘l qo‘yilmaydi, guvoh sifatida portal orqali xabar berish maqsadga muvofiq."
      },
      {
        title: "Savol 15",
        text: "Dilnoza ikki haftadan keyin ta’tilga chiqishni so‘radi — u borishni istagan tur uchun so‘nggi daqiqadagi katta chegirma paydo bo‘lgan edi. Jadvalga ko‘ra uning ta’tili oktyabr oyiga belgilangan, hozir esa bo‘limda hisobot davri. Rahbar rad javobini berdi va sentyabr oyida ta’tilga chiqishni taklif qildi. Bu xarassmentmi yoki yo‘l qo‘yiladigan xatti-harakatmi?",
        options: JSON.stringify([
          { key: "A", text: "BU — XARASSMENT..." },
          { key: "B", text: "BUNGA YO‘L QO‘YILADI — Jadvaldan tashqari ta’til tomonlarning kelishuvi asosida beriladi va rahbar bo‘limning ish yuklamasi hamda boshqa vazifalardan kelib chiqib rad etishga haqli." }
        ]),
        correctAnswer: "B",
        explanation: "Jadvaldan tashqari ta’til tomonlarning kelishuvi asosida beriladi, rahbar ish yuklamasidan kelib chiqib rad etishga haqli."
      }
    ];

    const tx = db.transaction((items) => {
      for (const it of items) qInsert.run(it);
    });
    tx(sampleQuestions);
  }
}
seed();

/* ---------- Telegram ---------- */
const tg = { username: '' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tgApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
async function notify(userId, text) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return;
  let ok = 0, err = '';
  if (!TOKEN) err = 'TELEGRAM_BOT_TOKEN sozlanmagan';
  else if (!u.tg_chat_id) err = 'Rahbar Telegramni ulamagan';
  else {
    try { const j = await tgApi('sendMessage', { chat_id: u.tg_chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }); ok = j.ok ? 1 : 0; if (!j.ok) err = j.description || 'Telegram xatosi'; }
    catch (e) { err = 'Tarmoq xatosi: ' + e.message; }
  }
  db.prepare('INSERT INTO tg_log(at,user_id,to_name,text,ok,error) VALUES(?,?,?,?,?,?)').run(Date.now(), u.id, u.fullname, text.replace(/<[^>]+>/g, ''), ok, err);
}
const notifyAdmins = text => Promise.all(db.prepare("SELECT id FROM users WHERE role='admin'").all().map(u => notify(u.id, text)));

async function handleTg(m) {
  const say = t => tgApi('sendMessage', { chat_id: m.chat.id, text: t }).catch(() => {});
  const mt = /^\/start(?:\s+(\S+))?/.exec(m.text.trim());
  if (!mt) return say("Bu bot rahbarlarga murojaat va eslatmalarni yuboradi. Ulash uchun tizimdagi kodni /start KOD ko'rinishida yuboring.");
  const u = mt[1] && db.prepare('SELECT * FROM users WHERE tg_code=? AND tg_code_exp>?').get(mt[1].toUpperCase(), Date.now());
  if (!u) return say("Kod noto'g'ri yoki muddati o'tgan. Tizimdagi profilingizdan yangi kod oling.");
  db.prepare('UPDATE users SET tg_chat_id=?, tg_code=NULL, tg_code_exp=NULL WHERE id=?').run(String(m.chat.id), u.id);
  say(`✅ Ulandi: ${u.fullname}. Endi murojaat va eslatmalar shu yerga keladi.`);
}
async function poll() {
  if (!TOKEN) return console.log('Telegram: TELEGRAM_BOT_TOKEN yo\'q, xabarlar faqat jurnalga yoziladi.');
  try { const me = await tgApi('getMe'); if (me.ok) { tg.username = me.result.username; console.log('Telegram bot: @' + tg.username); } else console.log('Telegram tokeni noto\'g\'ri:', me.description); } catch (e) { console.log('Telegramga ulanib bo\'lmadi:', e.message); }
  let off = 0;
  for (;;) {
    try {
      const j = await tgApi('getUpdates', { offset: off, timeout: 25, allowed_updates: ['message'] });
      if (!j.ok) { await sleep(8000); continue; }
      for (const u of j.result) { off = u.update_id + 1; if (u.message && u.message.text && u.message.chat.type === 'private') await handleTg(u.message); }
    } catch (e) { await sleep(8000); }
  }
}

async function runReminders() {
  const rows = db.prepare(`SELECT * FROM appeals WHERE status IN ('Yangi','Jarayonda','Qayta ishlash kerak')`).all();
  let n = 0;
  for (const a of rows) {
    const d = daysLeft(a.deadline);
    if (![10, 5, 3, 2, 1, 0].includes(d) && d >= 0) continue;
    if (!db.prepare('INSERT OR IGNORE INTO reminders(appeal_id,day) VALUES(?,?)').run(a.id, today()).changes) continue;
    const when = d < 0 ? `muddati ${-d} kun oldin o'tgan!` : d === 0 ? 'oxirgi muddat BUGUN!' : `ijroga ${d} kun qoldi.`;
    const msg = `⏰ <b>Eslatma ${a.number}</b>\n${h(a.name)} (${h(a.mahalla)}) murojaati: ${when}\nNatijani kiriting: ${BASE}`;
    await notify(a.user_id, msg); n++;
    if (d < 0) await notifyAdmins(`🚨 <b>Muddati o'tgan ${a.number}</b>\n${h(a.org)}: ${h(a.name)}, ${-d} kun kechikdi.`);
  }
  return n;
}
setInterval(() => {
  const g = db.prepare("SELECT v FROM meta WHERE k='last_reminder'").get();
  if (new Date().getHours() >= 9 && (!g || g.v !== today())) {
    db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('last_reminder',?)").run(today());
    runReminders().catch(e => console.log('Eslatma xatosi:', e.message));
  }
}, 60000);

/* ---------- Express ---------- */
if (!process.env.SESSION_SECRET) console.log('OGOHLANTIRISH: .env da SESSION_SECRET yo\'q, har qayta ishga tushganda sessiyalar tugaydi.');
const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(session({ name: 'sid', secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'), resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 12 * 3600e3 } }));
app.use(express.static(path.join(__dirname, 'public')));

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const auth = (req, res, next) => req.session.uid ? (req.me = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.uid), req.me ? next() : bad(res, 'Tizimga kiring.', 401)) : bad(res, 'Tizimga kiring.', 401);
const role = (...r) => (req, res, next) => r.includes(req.me.role) ? next() : bad(res, 'Huquq yetarli emas.', 403);
const pub = u => ({ id: u.id, fullname: u.fullname, position: u.position, username: u.username, role: u.role, org: u.org, tg_username: u.tg_username, tg_linked: !!u.tg_chat_id, must_change: !!u.must_change });
const staff = u => u.role !== 'org';
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

const tries = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip, t = tries.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 15 * 60e3) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 10) return bad(res, "Juda ko'p urinish. 15 daqiqadan keyin qayta urining.", 429);
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(str(req.body.username, 50).toLowerCase());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) { t.n++; tries.set(ip, t); return bad(res, "Login yoki parol noto'g'ri.", 401); }
  tries.delete(ip);
  req.session.regenerate(() => { req.session.uid = u.id; res.json({ user: pub(u), bot: tg.username }); });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: 1 })));
app.get('/api/me', auth, (req, res) => res.json({ user: pub(req.me), bot: tg.username }));
app.post('/api/me/password', auth, (req, res) => {
  const { old, pw } = req.body;
  if (!bcrypt.compareSync(String(old || ''), req.me.password_hash)) return bad(res, "Joriy parol noto'g'ri.");
  if (String(pw || '').length < 8) return bad(res, "Yangi parol kamida 8 belgi bo'lsin.");
  db.prepare('UPDATE users SET password_hash=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(pw, 10), req.me.id);
  res.json({ ok: 1 });
});
const makeCode = uid => { const c = crypto.randomBytes(4).toString('hex').toUpperCase(); db.prepare('UPDATE users SET tg_code=?, tg_code_exp=? WHERE id=?').run(c, Date.now() + 30 * 60e3, uid); return c; };
app.post('/api/me/tg-code', auth, (req, res) => res.json({ code: makeCode(req.me.id), bot: tg.username }));

/* Murojaatlar */
const scope = u => staff(u) ? { w: '', p: [] } : { w: 'WHERE a.org=?', p: [u.org] };
const canSee = (u, a) => a && (staff(u) || a.org === u.org);
const LIST = `SELECT a.*, u.fullname AS leader, (u.tg_chat_id IS NOT NULL) AS leader_tg, m.date AS meeting_date, m.number AS meeting_number,
  (SELECT COUNT(*) FROM responses r WHERE r.appeal_id=a.id AND r.state='pending') AS pending FROM appeals a JOIN users u ON u.id=a.user_id LEFT JOIN meetings m ON m.id=a.meeting_id`;
app.get('/api/appeals', auth, (req, res) => { const s = scope(req.me); res.json(db.prepare(`${LIST} ${s.w} ORDER BY a.id DESC`).all(...s.p)); });
app.get('/api/appeals/:id', auth, (req, res) => {
  const a = db.prepare(`${LIST} WHERE a.id=?`).get(req.params.id);
  if (!canSee(req.me, a)) return bad(res, 'Murojaat topilmadi.', 404);
  if (req.me.role === 'org' && a.status === 'Yangi') { db.prepare("UPDATE appeals SET status='Jarayonda' WHERE id=?").run(a.id); hist(a.id, req.me.id, "Murojaat ochildi, o'rganish boshlandi"); a.status = 'Jarayonda'; }
  res.json({ ...a,
    history: db.prepare('SELECT h.*, u.fullname FROM history h LEFT JOIN users u ON u.id=h.user_id WHERE appeal_id=? ORDER BY h.id').all(a.id),
    responses: db.prepare('SELECT r.id,r.text,r.file_name,r.state,r.admin_comment,r.created_at,r.decided_at,u.fullname FROM responses r JOIN users u ON u.id=r.user_id WHERE appeal_id=? ORDER BY r.id').all(a.id) });
});
function appealFields(req, res) {
  const b = req.body, u = db.prepare("SELECT * FROM users WHERE id=? AND role='org'").get(b.user_id);
  const f = { last_name: str(b.last_name, 60), first_name: str(b.first_name, 60), middle_name: str(b.middle_name, 60), mahalla: str(b.mahalla, 100),
    category: str(b.category, 60), subject: str(b.subject, 200), text: str(b.text, 3000), note: str(b.note, 1000), deadline: str(b.deadline, 10) };
  const need = { last_name: 'Familiya', first_name: 'Ism', middle_name: 'Otasining ismi', mahalla: 'Mahalla', subject: 'Murojaat masalasi', text: 'Murojaat mazmuni', deadline: 'Ijro muddati' };
  for (const k in need) if (!f[k]) return (bad(res, `${need[k]} majburiy.`), null);
  f.phone = normPhone(b.phone);
  if (!f.phone) return (bad(res, "Telefon raqami +998 XX XXX XX XX ko'rinishida bo'lishi shart."), null);
  if (!CATS.includes(f.category)) return (bad(res, 'Murojaat toifasini tanlang.'), null);
  if (!/^\d{4}-\d\d-\d\d$/.test(f.deadline)) return (bad(res, "Ijro muddati sanasi noto'g'ri."), null);
  const m = b.meeting_id ? db.prepare('SELECT * FROM meetings WHERE id=?').get(b.meeting_id) : null;
  if (!m) return (bad(res, "Murojaat qaysi bayonnomaga muvofiqligini tanlang."), null);
  if (f.deadline < m.date) return (bad(res, "Ijro muddati bayonnoma sanasidan oldin bo'lishi mumkin emas."), null);
  if (!u) return (bad(res, "Mas'ul rahbarni tanlang."), null);
  return { ...f, name: `${f.last_name} ${f.first_name} ${f.middle_name}`, date: m.date, org: u.org, user_id: u.id, meeting_id: m.id, mnum: m.number };
}
app.get('/api/categories', auth, (req, res) => res.json(CATS));
app.post('/api/appeals', auth, role('admin', 'hokim'), (req, res) => {
  const f = appealFields(req, res); if (!f) return;
  const n = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM appeals').get().n;
  const number = `MUR-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
  const id = db.prepare('INSERT INTO appeals(number,meeting_id,date,name,last_name,first_name,middle_name,phone,mahalla,category,subject,text,note,org,user_id,deadline,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(number, f.meeting_id, f.date, f.name, f.last_name, f.first_name, f.middle_name, f.phone, f.mahalla, f.category, f.subject, f.text, f.note, f.org, f.user_id, f.deadline, 'Yangi', Date.now()).lastInsertRowid;
  hist(id, req.me.id, `Murojaat ${f.org} ga yo'naltirildi (bayonnoma №${f.mnum || f.meeting_id}, ${f.date})`);
  notify(f.user_id, `📌 <b>Yangi murojaat ${number}</b>\nSizda ${f.date} sanasidagi payshanba uchrashuvi bayonnomasi bo'yicha yo'naltirilgan murojaat bor.\n👤 ${h(f.name)}, ${h(f.mahalla)}\n🏷 ${h(f.category)}: ${h(f.subject)}\n⏳ Ijro muddati: ${f.deadline}\n\nBayonnomani o'qib, tegishli tartibda o'rganib, natijani kabinetingiz orqali kiriting: ${BASE}`);
  res.status(201).json({ id });
});
app.put('/api/appeals/:id', auth, role('admin', 'hokim'), (req, res) => {
  const a = db.prepare('SELECT * FROM appeals WHERE id=?').get(req.params.id); if (!a) return bad(res, 'Topilmadi.', 404);
  const f = appealFields(req, res); if (!f) return;
  db.prepare('UPDATE appeals SET meeting_id=?,date=?,name=?,last_name=?,first_name=?,middle_name=?,phone=?,mahalla=?,category=?,subject=?,text=?,note=?,org=?,user_id=?,deadline=? WHERE id=?')
    .run(f.meeting_id, f.date, f.name, f.last_name, f.first_name, f.middle_name, f.phone, f.mahalla, f.category, f.subject, f.text, f.note, f.org, f.user_id, f.deadline, a.id);
  hist(a.id, req.me.id, "Murojaat ma'lumotlari tahrirlandi");
  if (f.user_id !== a.user_id) notify(f.user_id, `📌 <b>Sizga murojaat biriktirildi ${a.number}</b>\n${h(f.name)}, ${h(f.mahalla)}\n${h(f.category)}: ${h(f.subject)}\nMuddat: ${f.deadline}\n${BASE}`);
  res.json({ ok: 1 });
});
const dropFiles = aid => db.prepare('SELECT file FROM responses WHERE appeal_id=? AND file IS NOT NULL').all(aid).forEach(r => fs.unlink(path.join(UP, r.file), () => {}));
app.delete('/api/appeals/:id', auth, role('admin'), (req, res) => { dropFiles(req.params.id); db.prepare('DELETE FROM appeals WHERE id=?').run(req.params.id); res.json({ ok: 1 }); });

/* Javob xati */
const EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase()) }),
  fileFilter: (q, f, cb) => EXT.includes(path.extname(f.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Faqat PDF, rasm (JPG/PNG) yoki Word fayl yuklash mumkin.')) });
app.post('/api/appeals/:id/response', auth, role('org'), (req, res) => {
  upload.single('file')(req, res, err => {
    const rm = () => req.file && fs.unlink(req.file.path, () => {});
    if (err) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? "Fayl 10 MB dan oshmasin." : err.message);
    const a = db.prepare('SELECT * FROM appeals WHERE id=?').get(req.params.id), text = str(req.body.text, 5000);
    if (!canSee(req.me, a)) { rm(); return bad(res, 'Murojaat topilmadi.', 404); }
    if (!OPEN.includes(a.status)) { rm(); return bad(res, "Hozir javob xatini kiritib bo'lmaydi (holat: " + a.status + ').'); }
    if (text.length < 10) { rm(); return bad(res, "Javob matni kamida 10 belgi bo'lsin."); }
    db.prepare('INSERT INTO responses(appeal_id,user_id,text,file,file_name,created_at) VALUES(?,?,?,?,?,?)').run(a.id, req.me.id, text, req.file ? req.file.filename : null, req.file ? req.file.originalname.slice(0, 120) : null, Date.now());
    db.prepare("UPDATE appeals SET status='Tasdiqlash kutilmoqda' WHERE id=?").run(a.id);
    hist(a.id, req.me.id, 'Javob xati yuborildi, admin tasdig\'i kutilmoqda');
    notifyAdmins(`📨 <b>Javob xati ${a.number}</b>\n${h(a.org)} (${h(req.me.fullname)}) natija kiritdi: ${h(a.name)}.\nTasdiqlash uchun: ${BASE}`);
    res.status(201).json({ ok: 1 });
  });
});
app.post('/api/responses/:id/decide', auth, role('admin'), (req, res) => {
  const r = db.prepare('SELECT * FROM responses WHERE id=?').get(req.params.id);
  if (!r || r.state !== 'pending') return bad(res, "Bu javob ko'rib chiqilgan yoki topilmadi.");
  const map = { approve: ['approved', 'Ijobiy hal etildi', 'tasdiqlandi'], return: ['returned', 'Qayta ishlash kerak', 'qayta ishlashga qaytarildi'], reject: ['rejected', 'Rad etildi', 'rad etildi'] }[req.body.decision];
  const c = str(req.body.comment, 1000);
  if (!map) return bad(res, "Qaror noto'g'ri.");
  if (req.body.decision !== 'approve' && c.length < 3) return bad(res, 'Qaytarish yoki rad etish uchun izoh yozing.');
  const a = db.prepare('SELECT * FROM appeals WHERE id=?').get(r.appeal_id);
  db.transaction(() => {
    db.prepare('UPDATE responses SET state=?, admin_comment=?, decided_at=? WHERE id=?').run(map[0], c, Date.now(), r.id);
    db.prepare('UPDATE appeals SET status=? WHERE id=?').run(map[1], a.id);
    hist(a.id, req.me.id, `Javob xati ${map[2]}`, c);
  })();
  notify(r.user_id, `${req.body.decision === 'approve' ? '✅' : '↩️'} <b>${a.number}</b>: javob xatingiz ${map[2]}.${c ? '\nIzoh: ' + h(c) : ''}\n${BASE}`);
  res.json({ ok: 1 });
});
app.get('/api/responses/:id/file', auth, (req, res) => {
  const r = db.prepare('SELECT r.*, a.org FROM responses r JOIN appeals a ON a.id=r.appeal_id WHERE r.id=?').get(req.params.id);
  if (!r || !r.file || (!staff(req.me) && r.org !== req.me.org)) return bad(res, 'Fayl topilmadi.', 404);
  res.download(path.join(UP, r.file), r.file_name || r.file);
});

/* Bayonnomalar: qo'lda tuziladi, imzolangan PDF yuklanadi */
const uploadPdf = multer({ limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, 'bayonnoma-' + crypto.randomBytes(12).toString('hex') + '.pdf') }),
  fileFilter: (q, f, cb) => path.extname(f.originalname).toLowerCase() === '.pdf' ? cb(null, true) : cb(new Error('Bayonnoma faqat PDF shaklida yuklanadi.')) });
const isPdf = f => { try { const fd = fs.openSync(f.path, 'r'), b = Buffer.alloc(5); fs.readSync(fd, b, 0, 5, 0); fs.closeSync(fd); return b.toString() === '%PDF-'; } catch (e) { return false; } };
const MLIST = 'SELECT id,date,number,file_name,(file IS NOT NULL) AS has_file FROM meetings';
app.get('/api/meetings', auth, (req, res) => res.json(staff(req.me)
  ? db.prepare(`${MLIST} ORDER BY date DESC, id DESC`).all()
  : db.prepare(`${MLIST} WHERE id IN (SELECT meeting_id FROM appeals WHERE org=?) ORDER BY date DESC`).all(req.me.org)));
app.get('/api/meetings/:id/file', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!m || !m.file || (!staff(req.me) && !db.prepare('SELECT 1 FROM appeals WHERE meeting_id=? AND org=?').get(m.id, req.me.org))) return bad(res, 'Bayonnoma topilmadi.', 404);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(m.file_name || 'bayonnoma.pdf'));
  fs.createReadStream(path.join(UP, m.file)).on('error', () => res.end()).pipe(res);
});
const meetingSave = (create) => (req, res) => uploadPdf.single('file')(req, res, err => {
  const rm = () => req.file && fs.unlink(req.file.path, () => {});
  if (err) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'PDF 20 MB dan oshmasin.' : err.message);
  const date = str(req.body.date, 10), number = str(req.body.number, 30);
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !number) { rm(); return bad(res, 'Bayonnoma sanasi va raqamini kiriting.'); }
  if (req.file && !isPdf(req.file)) { rm(); return bad(res, 'Fayl haqiqiy PDF emas.'); }
  if (create && !req.file) return bad(res, 'Imzolangan bayonnoma PDF faylini yuklang.');
  if (create) return res.status(201).json({ id: db.prepare("INSERT INTO meetings(date,place,signer,agenda,decisions,number,file,file_name) VALUES(?,?,?,?,?,?,?,?)").run(date, '', '', '', '', number, req.file.filename, req.file.originalname.slice(0, 120)).lastInsertRowid });
  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(req.params.id);
  if (!m) { rm(); return bad(res, 'Topilmadi.', 404); }
  db.prepare('UPDATE meetings SET date=?, number=? WHERE id=?').run(date, number, m.id);
  if (req.file) { if (m.file) fs.unlink(path.join(UP, m.file), () => {}); db.prepare('UPDATE meetings SET file=?, file_name=? WHERE id=?').run(req.file.filename, req.file.originalname.slice(0, 120), m.id); }
  res.json({ ok: 1 });
});
app.post('/api/meetings', auth, role('admin', 'hokim'), meetingSave(true));
app.put('/api/meetings/:id', auth, role('admin', 'hokim'), meetingSave(false));
app.delete('/api/meetings/:id', auth, role('admin'), (req, res) => {
  if (db.prepare('SELECT 1 FROM appeals WHERE meeting_id=?').get(req.params.id)) return bad(res, "Bu bayonnomaga murojaatlar bog'langan, o'chirib bo'lmaydi.");
  const m = db.prepare('SELECT file FROM meetings WHERE id=?').get(req.params.id);
  if (m && m.file) fs.unlink(path.join(UP, m.file), () => {});
  db.prepare('DELETE FROM meetings WHERE id=?').run(req.params.id); res.json({ ok: 1 });
});

/* Rahbarlar (admin) */
app.get('/api/users', auth, role('admin', 'hokim'), (req, res) => res.json(db.prepare('SELECT * FROM users ORDER BY role, id').all().map(pub)));
function userFields(req, res, id) {
  const b = req.body, f = { fullname: str(b.fullname, 150), position: str(b.position, 150), username: str(b.username, 30).toLowerCase(), role: b.role, org: str(b.org, 150), tg_username: str(b.tg_username, 50) };
  if (!f.fullname || !['admin', 'hokim', 'org'].includes(f.role)) return bad(res, "F.I.Sh. va rolni to'g'ri kiriting."), null;
  if (!/^[a-z0-9_.-]{3,30}$/.test(f.username)) return bad(res, "Login 3-30 belgi: lotin harf, raqam, _ . -"), null;
  if (f.role === 'org' && !f.org) return bad(res, 'Tashkilot nomini kiriting.'), null;
  if (f.role !== 'org') f.org = f.org || 'Tuman Hokimligi';
  const dup = db.prepare('SELECT id FROM users WHERE username=?').get(f.username);
  if (dup && dup.id !== id) return bad(res, 'Bu login band.'), null;
  return f;
}
app.post('/api/users', auth, role('admin'), (req, res) => {
  const f = userFields(req, res); if (!f) return;
  if (String(req.body.password || '').length < 8) return bad(res, "Parol kamida 8 belgi bo'lsin.");
  res.status(201).json({ id: db.prepare('INSERT INTO users(fullname,position,username,password_hash,role,org,tg_username) VALUES(?,?,?,?,?,?,?)').run(f.fullname, f.position, f.username, bcrypt.hashSync(req.body.password, 10), f.role, f.org, f.tg_username).lastInsertRowid });
});
app.put('/api/users/:id', auth, role('admin'), (req, res) => {
  const id = +req.params.id, f = userFields(req, res, id); if (!f) return;
  const old = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!old) return bad(res, 'Topilmadi.', 404);
  if (id === req.me.id && f.role !== 'admin') return bad(res, "O'z rolingizni o'zgartira olmaysiz.");
  if (f.org !== old.org && db.prepare('SELECT 1 FROM appeals WHERE user_id=?').get(id)) return bad(res, "Murojaatlari bor rahbarning tashkilotini o'zgartirib bo'lmaydi.");
  db.prepare('UPDATE users SET fullname=?,position=?,username=?,role=?,org=?,tg_username=? WHERE id=?').run(f.fullname, f.position, f.username, f.role, f.org, f.tg_username, id);
  if (req.body.password) { if (String(req.body.password).length < 8) return bad(res, "Parol kamida 8 belgi bo'lsin."); db.prepare('UPDATE users SET password_hash=?, must_change=1 WHERE id=?').run(bcrypt.hashSync(req.body.password, 10), id); }
  res.json({ ok: 1 });
});
app.delete('/api/users/:id', auth, role('admin'), (req, res) => {
  const id = +req.params.id;
  if (id === req.me.id) return bad(res, "O'zingizni o'chira olmaysiz.");
  if (db.prepare('SELECT 1 FROM appeals WHERE user_id=?').get(id) || db.prepare('SELECT 1 FROM responses WHERE user_id=?').get(id)) return bad(res, "Murojaati bor rahbarni o'chirib bo'lmaydi. Avval murojaatlarni boshqasiga o'tkazing.");
  db.prepare('DELETE FROM users WHERE id=?').run(id); res.json({ ok: 1 });
});
app.post('/api/users/:id/tg-code', auth, role('admin'), (req, res) => res.json({ code: makeCode(+req.params.id), bot: tg.username }));

/* Statistika, jurnal, eslatma */
app.get('/api/stats', auth, (req, res) => {
  const s = scope(req.me), rows = db.prepare(`SELECT a.status, a.deadline FROM appeals a ${s.w}`).all(...s.p);
  const by = k => rows.filter(r => r.status === k).length;
  res.json({ total: rows.length, progress: by('Yangi') + by('Jarayonda') + by('Qayta ishlash kerak'), pending: by('Tasdiqlash kutilmoqda'), done: by('Ijobiy hal etildi'),
    urgent: rows.filter(r => OPEN.includes(r.status) && daysLeft(r.deadline) <= 5).length });
});
app.get('/api/tglog', auth, role('admin'), (req, res) => res.json(db.prepare('SELECT * FROM tg_log ORDER BY id DESC LIMIT 200').all()));
app.post('/api/reminders/run', auth, role('admin'), async (req, res) => res.json({ sent: await runReminders() }));

/* --- TEST SAVOLLARI API QISMI --- */
app.get('/api/quiz/questions', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM quiz_questions').all();
    const formatted = rows.map(row => ({
      ...row,
      options: JSON.parse(row.options)
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/quiz/check', (req, res) => {
  const { id, answer } = req.body;
  try {
    const question = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(id);
    if (!question) {
      return res.status(404).json({ success: false, message: "Savol topilmadi" });
    }
    const isCorrect = (question.correct_answer === answer);
    res.json({ 
      success: true, 
      isCorrect, 
      correctAnswer: question.correct_answer, 
      explanation: question.explanation 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* Tashkilotlar kesimida svodniy hisobot */
app.get('/api/reports/organizations', auth, (req, res) => {
  try {
    const report = db.prepare(`
      SELECT 
        org,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Yangi' THEN 1 ELSE 0 END) as yeni,
        SUM(CASE WHEN status = 'Jarayonda' THEN 1 ELSE 0 END) as jarayonda,
        SUM(CASE WHEN status = 'Tasdiqlash kutilmoqda' THEN 1 ELSE 0 END) as kutilmoqda,
        SUM(CASE WHEN status = 'Ijobiy hal etildi' THEN 1 ELSE 0 END) as ijobiy,
        SUM(CASE WHEN status = 'Rad etildi' THEN 1 ELSE 0 END) as rad,
        SUM(CASE WHEN status = 'Qayta ishlash kerak' THEN 1 ELSE 0 END) as qayta
      FROM appeals
      GROUP BY org
      ORDER BY total DESC
    `).all();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: 'Server xatoligi.' }); });

app.listen(PORT, () => { console.log(`Server: http://localhost:${PORT}`); poll(); });