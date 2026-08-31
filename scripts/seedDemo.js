/**
 * Seeds a demo dataset.
 *
 * Every record here is invented. No message, name or address in this file comes
 * from the community the application was originally built for — the public demo
 * runs on this data and nothing else.
 *
 * Categories are the original set (education, health, career, culture,
 * alternative, rights, young-generation), which the frontend's CategoryIcon and
 * the local category images are built around.
 *
 * Idempotent: re-running replaces the demo records rather than duplicating them.
 *
 *   node scripts/seedDemo.js
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import { getMongoUri } from '../src/config/env.js';
import User from '../src/apps/users/dataAccess/userModel.js';
import Category from '../src/apps/categories/dataAccess/categoryModel.js';
import Message from '../src/apps/messages/dataAccess/messageModel.js';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'seed-demo-pw-placeholder';

// The old admin account (admin@weunity.com / seed-demo-pw-placeholder) is included so the
// original credentials work in the demo. The others are generic demo logins.
const users = [
  { name: 'מנהל דמו', email: 'admin@demo.example.com', role: 'admin', password: DEMO_PASSWORD },
  { name: 'חבר דמו', email: 'member@demo.example.com', role: 'member', password: DEMO_PASSWORD },
  { name: 'מנהל (ותיק)', email: 'admin@weunity.com', role: 'admin', password: 'seed-demo-pw-placeholder' },
];

// `icon` holds the value the frontend CategoryIcon switches on — set to the
// title so each category renders its original SVG icon. categoryColor gives
// each a distinct accent.
const categories = [
  { title: 'חינוך', icon: 'חינוך', attachmentKey: 'demo/placeholder', categoryColor: '#2563EB' },
  { title: 'בריאות', icon: 'בריאות', attachmentKey: 'demo/placeholder', categoryColor: '#DC2626' },
  { title: 'קריירה', icon: 'קריירה', attachmentKey: 'demo/placeholder', categoryColor: '#7C3AED' },
  { title: 'תרבות', icon: 'תרבות', attachmentKey: 'demo/placeholder', categoryColor: '#DB2777' },
  { title: 'אלטרנטיבי', icon: 'אלטרנטיבי', attachmentKey: 'demo/placeholder', categoryColor: '#059669' },
  { title: 'זכויות', icon: 'זכויות', attachmentKey: 'demo/placeholder', categoryColor: '#D97706' },
  { title: 'דור צעיר', icon: 'דור צעיר', attachmentKey: 'demo/placeholder', categoryColor: '#0891B2' },
];

// A deliberate MIX of visibility tiers so the showcase demonstrates both:
//  - 'public'  — visible to anyone. There are 18 of these (>=15 as requested).
//  - 'members' — withheld from anonymous callers; labelled "(תוכן לחברים בלבד)".
// Each message names its `category` by title; the id is resolved after the
// categories are created. Bodies are 2–3 sentences so the feed reads as real.
const messages = [
  // ── חינוך ──
  { category: 'חינוך', visibility: 'public', title: 'נפתחה ההרשמה לגן הילדים', text: 'ההרשמה לשנת הלימודים הקרובה נפתחה ותיסגר בסוף החודש. יש למלא את טופס הרישום ולצרף צילום תעודת זהות של ההורה. לשאלות ניתן לפנות לצוות הגן בשעות הבוקר. (הודעת הדגמה)' },
  { category: 'חינוך', visibility: 'public', title: 'סדנת העשרה במתמטיקה', text: 'סדנה שבועית לתלמידי כיתות ד׳–ו׳ תיפתח ביום שלישי אחר הצהריים בחדר החוגים. הסדנה מתמקדת בחיזוק ביטחון והבנה דרך משחקים וחידות. מספר המקומות מוגבל. (הודעת הדגמה)' },
  { category: 'חינוך', visibility: 'members', title: 'רשימת תלמידים לחונכות אישית', text: 'הרשימה המלאה והשיבוץ למורים זמינים לחברי צוות החינוך בלבד. הרשימה כוללת פרטי קשר והערות אישיות, ולכן מוגבלת לצפייה. (תוכן לחברים בלבד) (הודעת הדגמה)' },
  // ── בריאות ──
  { category: 'בריאות', visibility: 'public', title: 'שינוי בשעות פתיחת המרפאה', text: 'החל מהשבוע הקרוב המרפאה תפתח בשעה 08:00 במקום 07:30. השינוי נובע מהתאמת לוח המשמרות החדש. במקרה חירום ניתן להמשיך להתקשר לקו הכוננות. (הודעת הדגמה)' },
  { category: 'בריאות', visibility: 'public', title: 'חיסוני שפעת עונתיים', text: 'ניתן להתחסן במרפאה בימים א׳ ו-ג׳ בין 09:00 ל-12:00, ללא תור מראש. החיסון מומלץ במיוחד לבני גיל השלישי ולאנשים עם מחלות רקע. אין צורך להביא טופס. (הודעת הדגמה)' },
  { category: 'בריאות', visibility: 'public', title: 'הרצאה: תזונה נכונה בקיץ', text: 'הרצאה פתוחה לקהל עם דיאטנית קלינית, ביום חמישי בשעה 19:00 במועדון. נדבר על שתייה, קירור נכון ואיזון בימי החום. הכניסה חופשית וללא עלות. (הודעת הדגמה)' },
  { category: 'בריאות', visibility: 'members', title: 'פרטי כוננות רפואית לילה', text: 'שמות ומספרי טלפון של הכוננים זמינים לחברי הקהילה בלבד. אנא לשמור על הפרטיות ולהתקשר רק במקרה צורך אמיתי. (תוכן לחברים בלבד) (הודעת הדגמה)' },
  // ── קריירה ──
  { category: 'קריירה', visibility: 'public', title: 'דרושים: רכז/ת פעילות נוער', text: 'משרה חלקית לרכז/ת פעילות נוער בשעות אחר הצהריים והערב. התפקיד כולל הפעלת חוגים, ליווי טיולים ועבודה מול הורים. קורות חיים ניתן לשלוח למזכירות. (הודעת הדגמה)' },
  { category: 'קריירה', visibility: 'public', title: 'סדנת כתיבת קורות חיים', text: 'סדנה מעשית בהנחיית יועצת תעסוקה, שתעזור לבנות קורות חיים בולטים ולהתכונן לראיון עבודה. המפגש מתאים למחפשי עבודה ולמעוניינים בשינוי קריירה. מקומות מוגבלים. (הודעת הדגמה)' },
  { category: 'קריירה', visibility: 'members', title: 'טבלת שכר ותנאים מעודכנת', text: 'המסמך המלא עם טבלאות השכר והתנאים זמין לחברים לאחר התחברות. הנתונים עודכנו לשנה הנוכחית. (תוכן לחברים בלבד) (הודעת הדגמה)' },
  // ── תרבות ──
  { category: 'תרבות', visibility: 'public', title: 'ערב שירה בציבור', text: 'מפגש שירה בציבור בליווי אקורדיון, ביום שישי בשעה 20:30 בדשא המרכזי. שירון עם מיטב השירים העבריים. מוזמנים להביא כיסאות נוחים. (הודעת הדגמה)' },
  { category: 'תרבות', visibility: 'public', title: 'הצגת ילדים בחג', text: 'הצגה לכל המשפחה תתקיים באולם המופעים. מומלץ להגיע מוקדם כדי לתפוס מקומות טובים. כניסה חופשית. (הודעת הדגמה)' },
  { category: 'תרבות', visibility: 'public', title: 'חוג ציור למבוגרים', text: 'נפתח חוג ציור בהנחיית אמן מקומי, בימי שני בערב. החוג מתאים לכל הרמות, גם למתחילים. החומרים כלולים בעלות ההשתתפות. (הודעת הדגמה)' },
  // ── אלטרנטיבי ──
  { category: 'אלטרנטיבי', visibility: 'public', title: 'שיעור יוגה בבוקר', text: 'שיעור יוגה פתוח על הדשא, בימי שבת בשעה 07:30. השיעור מתאים לכל הרמות ומועבר באווירה נעימה. הביאו מזרן ובקבוק מים. (הודעת הדגמה)' },
  { category: 'אלטרנטיבי', visibility: 'public', title: 'קבוצת מדיטציה שבועית', text: 'מפגש מדיטציה מודרכת בימי רביעי בערב במרכז הקהילתי. המפגש מתאים גם למתחילים ואין צורך בניסיון קודם. (הודעת הדגמה)' },
  { category: 'אלטרנטיבי', visibility: 'members', title: 'רשימת מטפלים משלימים מומלצים', text: 'רשימה שנאספה על ידי חברי הקהילה, זמינה לאחר התחברות. ההמלצות אישיות ולא תחליף לייעוץ רפואי. (תוכן לחברים בלבד) (הודעת הדגמה)' },
  // ── זכויות ──
  { category: 'זכויות', visibility: 'public', title: 'ייעוץ זכויות חינם', text: 'עורך דין מתנדב ייתן ייעוץ ראשוני בנושאי זכויות, בתיאום מראש. השירות ניתן בדיסקרטיות מלאה וללא עלות. לקביעת תור פנו למזכירות. (הודעת הדגמה)' },
  { category: 'זכויות', visibility: 'public', title: 'מדריך למימוש זכאות דיור', text: 'מדריך מפורט הוכן עבור התושבים ומסביר שלב-אחר-שלב את תהליך מימוש הזכאות. המדריך זמין במזכירות ובאתר. (הודעת הדגמה)' },
  { category: 'זכויות', visibility: 'public', title: 'עדכון בנוגע למענקים', text: 'התקבל עדכון על מענקים חדשים לתושבים הזכאים. הפרטים המלאים והקריטריונים יפורסמו בימים הקרובים. מומלץ לעקוב אחר ההודעות. (הודעת הדגמה)' },
  // ── דור צעיר ──
  { category: 'דור צעיר', visibility: 'public', title: 'מסיבת סיום לבוגרי י״ב', text: 'המסיבה תתקיים בשבוע הבא באולם האירועים. פרטים על ההרשמה ולוח הזמנים אצל רכזת הנוער. מחכים לערב חגיגי! (הודעת הדגמה)' },
  { category: 'דור צעיר', visibility: 'public', title: 'טורניר כדורגל לנוער', text: 'טורניר קיץ פתוח לכל הגילאים, נרשמים בזוגות. המשחקים יתקיימו במגרש המרכזי בימי שישי. הרשמה אצל רכז הספורט. (הודעת הדגמה)' },
  { category: 'דור צעיר', visibility: 'public', title: 'נמצא תיק גב ליד המגרש', text: 'תיק גב שחור נמצא ליד מגרש הכדורסל. בתוכו בקבוק מים ומחברת. ניתן לאסוף מהמזכירות בשעות הפעילות. (הודעת הדגמה)' },
  { category: 'דור צעיר', visibility: 'members', title: 'רשימת מדריכי הקייטנה', text: 'שמות ומשבצות המדריכים זמינים לחברים לאחר התחברות. הרשימה כוללת את פרטי הקשר של כל מדריך. (תוכן לחברים בלבד) (הודעת הדגמה)' },
];

const run = async () => {
  await mongoose.connect(getMongoUri());
  console.log('connected');

  await User.deleteMany({ email: { $in: users.map((u) => u.email) } });
  // emailVerified: true — seeded accounts must be able to log in immediately;
  // login refuses any account whose email is not yet verified.
  const createdUsers = await User.create(
    await Promise.all(
      users.map(async (u) => ({
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 12),
        emailVerified: true,
      })),
    ),
  );
  console.log(`users: ${createdUsers.length}`);

  await Category.deleteMany({});
  const createdCategories = await Category.create(categories);
  const catIdByTitle = Object.fromEntries(createdCategories.map((c) => [c.title, String(c._id)]));
  console.log(`categories: ${createdCategories.length}`);

  await Message.deleteMany({});
  const createdMessages = await Message.create(
    messages.map((m) => ({
      title: m.title,
      text: m.text,
      visibility: m.visibility,
      categoryId: catIdByTitle[m.category],
      senderId: String(createdUsers[0]._id),
    })),
  );

  // Spread createdAt over the past ~75 days so the feed looks like real activity
  // over time. A direct $set bypasses mongoose's timestamp auto-fill.
  const now = Date.now();
  await Message.collection.bulkWrite(
    createdMessages.map((doc) => {
      const daysAgo = Math.floor(Math.random() * 75);
      const hour = 7 + Math.floor(Math.random() * 14);
      const when = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
      when.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
      return { updateOne: { filter: { _id: doc._id }, update: { $set: { createdAt: when } } } };
    }),
  );

  const publicCount = messages.filter((m) => m.visibility === 'public').length;
  console.log(`messages: ${createdMessages.length} (${publicCount} public, ${createdMessages.length - publicCount} members-only)`);

  await mongoose.connection.close();
  console.log(`\ndone. sign in with ${users[0].email} / ${DEMO_PASSWORD}  (or admin@weunity.com / seed-demo-pw-placeholder)`);
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.connection.close();
  process.exit(1);
});
