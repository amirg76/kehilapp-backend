#!/usr/bin/env node
/**
 * Fails when a source file carries a RAW Unicode bidirectional control character.
 *
 * Why this exists. A test in this repo needed a string containing U+202E
 * (RIGHT-TO-LEFT OVERRIDE) and it was written as the literal character. In an
 * editor or a diff that character silently reverses the display of everything
 * after it on the line, so what a reviewer READS is not what the parser PARSES
 * ("Trojan Source", CVE-2021-42574). The fix is to write such characters as
 * `\u202E` escapes, which this check cannot object to because the file then
 * holds six ASCII characters, not the control character.
 *
 * Scope: src/ and scripts/ (every file, every extension). Hebrew text and other
 * RTL letters are NOT flagged -- only the invisible control characters below.
 *
 *   node scripts/no-raw-bidi-check.mjs            # exit 0 = clean, 1 = found
 *   node scripts/no-raw-bidi-check.mjs some/dir   # scan other roots instead
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DEFAULT_ROOTS = ['src', 'scripts'];

// U+061C  ARABIC LETTER MARK
// U+200E  LEFT-TO-RIGHT MARK        U+200F  RIGHT-TO-LEFT MARK
// U+202A..U+202E  LRE, RLE, PDF, LRO, RLO (embeddings and overrides)
// U+2066..U+2069  LRI, RLI, FSI, PDI (isolates)
const BIDI_CONTROL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

const NAMES = {
  0x061c: 'ARABIC LETTER MARK',
  0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
};

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const findings = [];
const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;

for (const root of roots) {
  for (const file of walk(join(REPO_ROOT, root))) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const m = BIDI_CONTROL.exec(line);
      if (!m) return;
      const cp = m[0].codePointAt(0);
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      findings.push(`${relative(REPO_ROOT, file)}:${i + 1}:${m.index + 1}  U+${hex} ${NAMES[cp] || ''}`);
    });
  }
}

if (findings.length) {
  console.error(`Raw bidi control character(s) found in ${findings.length} place(s):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('Write them as \\uXXXX escapes instead of the raw character.');
  process.exit(1);
}

console.log(`no-raw-bidi-check: clean (${roots.join(', ')})`);
