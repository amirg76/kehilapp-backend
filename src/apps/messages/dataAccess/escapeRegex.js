/**
 * Escape every regex metacharacter so a search term is matched literally.
 *
 * The search endpoint used to hand the raw query string to `new RegExp(...)` and
 * then to Mongo's $regex. Two problems: a term like `(a+)+$` makes the regex
 * engine backtrack catastrophically and pins the CPU (ReDoS), and characters
 * like `.` or `|` quietly changed what the search meant.
 */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default escapeRegex;
