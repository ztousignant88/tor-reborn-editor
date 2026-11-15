// Game text <-> editable text. Control sequences are EF A3 BF <op> <args>
// (op byte 0x80+n; size per op from Asvel's GameTextEncoding, Unlicense).
// In the editable form:
//   - the leading op 0x29 and the op 0x01 marks after words are hidden and
//     re-inserted on save (they are layout codes present on most lines);
//   - line breaks (ops 0x00/0x06) become "\n";
//   - every other code becomes a {XX} or {XX:hexargs} token that can be moved
//     or deleted but should not be retyped by hand.

const OP_SIZES = [
  1, 3, 5, 6, 5, 3, 1, 2, 2, 2, 2, 3, 2, 3, 3, 3,
  3, 1, 1, 1, 1, 4, 1, 1, 3, 3, 2, 1, 3, 2, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 1, 3, 3,
  1, 1, 4, 4, 3, 3,
];
const LEAD = 0x29, WORD = 0x01, NEWLINES = new Set([0x00, 0x06]);
const MARK = [0xEF, 0xA3, 0xBF];

/** Named tokens shown instead of hex for codes whose meaning is known. */
const ALIASES = { 0x13: 'Leader' }; // op 0x13: the player's name (Denam by default)
const ALIAS_OPS = Object.fromEntries(Object.entries(ALIASES).map(([op, name]) => [name.toLowerCase(), Number(op)]));

const hex = (b) => b.toString(16).toUpperCase().padStart(2, '0');

export function decodeForEdit(bytes) {
  const info = { lead: false, words: false, wordArgs: [0x01, 0x01], newline: 0x00 };
  let text = '';
  let i = 0, start = 0;
  const flush = (end) => { if (end > start) text += new TextDecoder().decode(bytes.subarray(start, end)); };
  while (i < bytes.length) {
    if (bytes[i] === MARK[0] && bytes[i + 1] === MARK[1] && bytes[i + 2] === MARK[2] && i + 3 < bytes.length) {
      flush(i);
      const op = bytes[i + 3] - 0x80;
      const size = OP_SIZES[op] ?? 1;
      const args = bytes.subarray(i + 4, i + 3 + size);
      if (op === LEAD && i === 0) info.lead = true;
      else if (op === WORD) { info.words = true; info.wordArgs = [...args]; }
      else if (NEWLINES.has(op)) { text += '\n'; info.newline = op; }
      else if (ALIASES[op] && !args.length) text += `{${ALIASES[op]}}`;
      else text += `{${hex(op)}${args.length ? `:${[...args].map(hex).join('')}` : ''}}`;
      i += 3 + size;
      start = i;
    } else {
      i++;
    }
  }
  flush(i);
  return { text, info };
}

export function encodeFromEdit(text, info) {
  const parts = [];
  const code = (op, args = []) => parts.push(new Uint8Array([...MARK, 0x80 + op, ...args]));
  const plain = (s) => { if (s) parts.push(new TextEncoder().encode(s)); };
  if (info.lead) code(LEAD);
  const re = /\{([0-9A-Fa-f]{2})(?::([0-9A-Fa-f]*))?\}|\{([A-Za-z]+)\}|\n| /g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    if (m[0] === '\n') code(info.newline);
    else if (m[0] === ' ') {
      plain(' ');
      // word marks follow each space that precedes more text
      if (info.words && m.index + 1 < text.length && text[m.index + 1] !== ' ' && text[m.index + 1] !== '\n') code(WORD, info.wordArgs);
    } else if (m[3]) {
      const op = ALIAS_OPS[m[3].toLowerCase()];
      if (op === undefined) plain(m[0]); else code(op);
    } else {
      const args = (m[2] || '').match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
      code(parseInt(m[1], 16), args);
    }
    last = re.lastIndex;
  }
  plain(text.slice(last));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Text as the game would show it (tokens removed, leader name filled in). */
export function displayText(text, leader = 'Denam') {
  return text.replace(/\{Leader\}/gi, leader).replace(/\{[0-9A-F]{2}(?::[0-9A-F]*)?\}/gi, '');
}
