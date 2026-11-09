const EXTRA_STRIPPED = new Set([0x2028, 0x2029, 0x061c, 0xfeff, 0x2060, 0x00ad]);

function isStripped(cp: number): boolean {
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2066 && cp <= 0x2069) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  return EXTRA_STRIPPED.has(cp);
}

// Makes a short, single-line commit subject from the agent's message.
export function sanitizeMessage(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      out += ' ';
    } else if (!isStripped(cp)) {
      out += ch;
    }
  }
  const collapsed = out.replace(/ +/g, ' ').trim();
  return Array.from(collapsed).slice(0, 72).join('').trim();
}
