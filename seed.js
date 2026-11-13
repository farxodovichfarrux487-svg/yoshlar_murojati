const Database = require('better-sqlite3');
const db = new Database('database.db');

// 1. Jadvalni yaratish
db.prepare(`
  CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    text TEXT,
    options TEXT,
    correct_answer TEXT,
    explanation TEXT
  )
`).run();

// 2. 15 ta test savollari
const questions = [
  {
    title: "Savol 7",
    text: "Jabrlangan shaxs murojaatini qaytarib oldi va ko‘rib chiqishni tugatishni so‘radi. Materiallarda jinsiy majburlash va xizmat jihatidan qaramlik alomatlari mavjud. Qanday yo‘l tutish lozim?",
    options: JSON.stringify([
      { key: "A", text: "Masalani hal etishni tashkilot rahbarining ixtiyoriga qoldirish" },
      { key: "B", text: "Ko‘rib chiqishni davom ettirish: xavfsizlikka tahdid, zo‘ravonlik, jinsiy majburlash va hokazo holatlarda murojaatni qaytarib olish ko‘rib chiqishni tugatmaydi" },
      { key: "D", text: "Ko‘rib chiqishni tugatish, biroq jamoa o‘rtasida umumiy so‘rov o‘tkazish" },
      { key: "E", text: "Jabrlangan shaxsning pozitsiyasi hal qiluvchi ahamiyatga ega bo‘lgani uchun ko‘rib chiqishni tugatish" }
    ]),
    correctAnswer: "B",
    explanation: "Xavfsizlikka tahdid, zo‘ravonlik yoki jinsiy majburlash mavjud bo‘lsa, murojaatni qaytarib olish ko‘rib chiqishni to‘xtatmaydi."
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
    explanation: "Manfaatlar to‘qnashuvi aniqlanganda ko‘rib chiqish to‘xtatilib, vertikal tartibda boshqa shaxsga yuborilishi ta’minlanadi."
  }
  // Qolgan savollarni ham xuddi shunday formatda qo'shib chiqishingiz mumkin
];

// 3. Bazaga yozish
const insert = db.prepare(`
  INSERT INTO quiz_questions (title, text, options, correct_answer, explanation)
  VALUES (@title, @text, @options, @correctAnswer, @explanation)
`);

const transaction = db.transaction((items) => {
  for (const item of items) insert.run(item);
});

transaction(questions);
console.log("Barcha savollar bazaga muvaffaqiyatli saqlandi!");