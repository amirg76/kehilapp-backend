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
import { randomBytes } from 'crypto';

import { getMongoUri } from '../src/config/env.js';
import { isKnownNonProduction, nodeEnvName } from '../src/config/environment.js';
import User from '../src/apps/users/dataAccess/userModel.js';
import Category from '../src/apps/categories/dataAccess/categoryModel.js';
import Message from '../src/apps/messages/dataAccess/messageModel.js';

/**
 * NO PASSWORD LITERAL LIVES IN THIS FILE — keep it that way.
 *
 * A password written here is published the moment the repository is, and stays
 * published in the history afterwards whether or not the line is later deleted.
 * So the demo does not get a password it can leak: each seeded account takes its
 * password from an environment variable, or, when none is set, from a fresh
 * random one generated at seed time and printed to stdout for the developer who
 * just ran it. The demo stays a one-command experience; the secret simply stops
 * being a constant.
 *
 * DEMO_PASSWORD sets one password for every seeded account.
 * DEMO_ADMIN_PASSWORD / DEMO_MEMBER_PASSWORD override it per role.
 * Set none of them and the script generates and prints per-account passwords.
 */
const randomPassword = () => randomBytes(18).toString('base64url');

/**
 * Resolves the password for one seeded account: the per-role variable, then the
 * shared one, then a freshly generated one. The caller prints what it got.
 */
const passwordFor = (roleVar) => process.env[roleVar] || process.env.DEMO_PASSWORD || randomPassword();

/**
 * The databases this script is allowed to seed.
 *
 *   kehilapp_demo  — scripts/live-stack.cjs: mongod.getUri('kehilapp_demo')
 *                    scripts/atlas-stack.cjs: ATLAS_DEMO_DB || 'kehilapp_demo'
 *
 * `kehilapp` USED TO BE ON THIS LIST AND MUST NEVER RETURN. That is the name of
 * the ORDINARY APPLICATION DATABASE — docs/05-running-locally.md hands it to
 * every developer as `mongodb://127.0.0.1:27017/kehilapp`. Allowing it meant the
 * allowlist protecting the real board contained the real board: one
 * `node scripts/seedDemo.js` against a normal local .env deleted every category
 * and message in it. The demo databases are the two named above and nothing else.
 *
 * The database NAME is the right discriminator here: both stack scripts pin one
 * deliberately, and the real deployment reaches Mongo through a MONGO_URI that
 * names a different database. Checking the host instead would be wrong — the
 * Atlas demo shares its cluster with non-demo databases, which is exactly why
 * atlas-stack.cjs forces a dedicated database in the first place.
 */
const APPLICATION_DATABASE = 'kehilapp';
const DEMO_SUFFIX = '_demo';

/**
 * ATLAS_DEMO_DB, but only if it actually names a demo database.
 *
 * The second entry of the allowlist USED TO BE `process.env.ATLAS_DEMO_DB` raw,
 * accepted unchecked. That made the allowlist writable from the environment, so
 *
 *     ATLAS_DEMO_DB=kehilapp NODE_ENV=development node scripts/seedDemo.js
 *
 * put the real board straight back on the list of databases this script may
 * wipe — one variable undoing the whole guard, with the comment above still
 * claiming only two named databases were allowed.
 *
 * THE RULE: the name must end in `_demo`. Chosen because it is not a blocklist —
 * a blocklist of `kehilapp` would still have let through `kehilapp-prod`, the
 * board's backup, or any other real database — and because it is the convention
 * the project already follows (`kehilapp_demo` in both stack scripts). A database
 * somebody is willing to see emptied and refilled with invented content can be
 * renamed to say so; a production database cannot be renamed by accident.
 *
 * An invalid value is REFUSED, not ignored. Silently dropping it would leave the
 * Atlas operator staring at a refusal naming a database they thought they had
 * allowed.
 */
const atlasDemoDatabase = () => {
  const raw = (process.env.ATLAS_DEMO_DB || '').trim();
  if (!raw) return '';
  if (raw === APPLICATION_DATABASE) {
    console.error(
      `seedDemo: refusing ATLAS_DEMO_DB="${raw}" — that is the name of the real application database. This script deletes every category and message it finds; it will not be pointed at the board by an environment variable.`,
    );
    process.exit(1);
  }
  if (!raw.endsWith(DEMO_SUFFIX)) {
    console.error(
      `seedDemo: refusing ATLAS_DEMO_DB="${raw}" — a database this script may empty must be named as one, ending in "${DEMO_SUFFIX}". Rename the demo database, or seed it by hand.`,
    );
    process.exit(1);
  }
  return raw;
};

const DEMO_DATABASES = ['kehilapp_demo', atlasDemoDatabase()].filter(Boolean);

/**
 * The database a Mongo connection string resolves to, or '' when it names none.
 * Credentials are stripped before anything is read, so nothing secret can reach
 * a log line built from this value.
 */
const databaseNameOf = (uri) => {
  const [authority] = String(uri)
    .replace(/^mongodb(\+srv)?:\/\//i, '')
    .split('?');
  const afterCredentials = authority.slice(authority.lastIndexOf('@') + 1);
  const slash = afterCredentials.indexOf('/');
  if (slash === -1) return '';
  try {
    return decodeURIComponent(afterCredentials.slice(slash + 1));
  } catch {
    return afterCredentials.slice(slash + 1);
  }
};

/** Exits non-zero unless this is demonstrably a demo target. */
const refuseNonDemoTarget = () => {
  // What this guard protects against is a DEMO DATASET LANDING IN A REAL
  // DATABASE. The script deletes every category and message it finds and replaces
  // them with invented content, then creates accounts that belong to nobody. None
  // of that is recoverable by re-running anything. (It is no longer about a
  // published password — there is none in this file any more.)
  // DEFAULT-DENY, and not `isProduction()`. This script must run only where the
  // environment is a KNOWN development one. `NODE_ENV === 'production'` was
  // false under `npm run prod`, and it would be just as false under 'staging' or
  // a typo — a guard that only recognises one dangerous spelling is silent
  // everywhere else. So the list that matters is the SAFE one.
  if (!isKnownNonProduction()) {
    console.error(
      `seedDemo: refusing to run with NODE_ENV=${nodeEnvName()} — this script deletes the categories and messages it finds and replaces them with invented demo content. Run it only with NODE_ENV set to one of: local, dev, development, test.`,
    );
    process.exit(1);
  }

  // Deliberately NOT gated on a remote host. The Atlas demo IS remote, and the
  // database-name allowlist below is the discriminator that actually separates a
  // demo from a real board — adding a "are you sure, it is not localhost" flag
  // would fire on the one remote target that is legitimate and on nothing else.

  // Never printed: the URI itself, which carries credentials. Only the database
  // name, which atlas-stack.cjs already prints.
  const dbName = databaseNameOf(getMongoUri());
  if (!DEMO_DATABASES.includes(dbName)) {
    console.error(
      `seedDemo: refusing to seed database "${dbName || '(none named in MONGO_URI)'}" — only the demo databases [${DEMO_DATABASES.join(', ')}] may be seeded. Set ATLAS_DEMO_DB if the demo database is named differently.`,
    );
    process.exit(1);
  }
};

// Two generic demo logins — one admin so admin work can be demonstrated, one
// member. The old admin@weunity.com account is gone on purpose: it existed only
// to carry a password literal, and that literal is what this file no longer has.
// Passwords are resolved at run time, never written here.
const users = [
  { name: 'מנהל דמו', email: 'admin@demo.example.com', role: 'admin', passwordVar: 'DEMO_ADMIN_PASSWORD' },
  { name: 'חבר דמו', email: 'member@demo.example.com', role: 'member', passwordVar: 'DEMO_MEMBER_PASSWORD' },
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
  // Before anything opens a connection: a refusal must cost nothing.
  refuseNonDemoTarget();

  await mongoose.connect(getMongoUri());
  console.log('connected');

  await User.deleteMany({ email: { $in: users.map((u) => u.email) } });

  // Resolved once, here, so the same value is hashed and printed. Held in memory
  // for the length of this run and never written to the repository.
  const credentials = users.map((u) => ({ ...u, password: passwordFor(u.passwordVar) }));

  // emailVerified: true — seeded accounts must be able to log in immediately;
  // login refuses any account whose email is not yet verified.
  // approved: true — a demo must open on a working board, not on two accounts
  // waiting for an admin to admit them to the community.
  const approvedAt = new Date();
  const createdUsers = await User.create(
    await Promise.all(
      credentials.map(async (u) => ({
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 12),
        emailVerified: true,
        approved: true,
        approvedAt,
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

  // Printed, not stored. This is the only place the generated passwords appear,
  // and only in the terminal of whoever just ran the seed. Re-running the seed
  // issues new ones. Never send this output anywhere — see the guard above for
  // why this is only ever a development terminal.
  console.log('\ndone. sign in with:');
  credentials.forEach((u) => {
    const source = process.env[u.passwordVar] || process.env.DEMO_PASSWORD ? 'from env' : 'generated for this run';
    console.log(`  ${u.role.padEnd(6)} ${u.email}  ${u.password}   (${source})`);
  });
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.connection.close();
  process.exit(1);
});
