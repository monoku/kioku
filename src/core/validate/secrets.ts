/**
 * What is never saved, in any brain, in any kind (§1.5 layer 1, §5.1 rule 8). One list; each entry says what it
 * matches. A finding names the pattern and the line and never repeats the match.
 */
interface Pattern {
  name: string;
  re: RegExp;
  /** A second look at a match, for forms a regular expression alone over-matches (card and account numbers). */
  verify?: (match: string) => boolean;
}

const luhn = (digits: string): boolean => {
  let sum = 0;
  [...digits].reverse().forEach((c, i) => {
    let d = Number(c);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  });
  return sum % 10 === 0;
};

/** ISO 13616: move the first four characters to the end, letters become 10..35, the number mod 97 is 1. */
const ibanValid = (iban: string): boolean => {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
};

const PATTERNS: Pattern[] = [
  // Tokens and keys of the common hosts and clouds.
  { name: "a private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "an AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "a GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { name: "a GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "a Stripe key", re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { name: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "an npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "a SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { name: "a Twilio key", re: /\b(?:AC|SK)[0-9a-f]{32}\b/ },
  { name: "a Mailgun key", re: /\bkey-[0-9a-f]{32}\b/ },
  { name: "a Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,}\b/ },
  { name: "a DigitalOcean token", re: /\bdop_v1_[a-f0-9]{64}\b/ },
  { name: "a Shopify token", re: /\bshp(?:at|ca|pa|ss)_[a-f0-9]{32}\b/ },
  { name: "a PyPI token", re: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/ },
  { name: "an Azure storage account key", re: /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/ },
  { name: "an API key (sk-)", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "a JSON web token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  // Credentials written as text.
  { name: "a bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { name: "a connection string with credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s/]+/i },
  // The label may close a variable name, DB_PASSWORD or OPENAI_API_KEY: `\b` does not fall inside one, after `_`.
  {
    name: "a password or token assignment",
    re: /(?<![A-Za-z0-9])(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-+/=.]{20,}/i,
  },
  // Government identifiers, as the team meets them: a label followed by the number.
  { name: "a US social security number", re: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/ },
  {
    name: "a national identity number",
    re: /\b(?:c[eé]dula(?: de ciudadan[ií]a)?|C\.?C\.?|NIT|DNI|NIE|passport|pasaporte|SSN|CURP|RFC)\b[\s.:#nNoO°]{0,6}\d[\d.\s-]{5,14}\d\b/,
  },
  // Financial account numbers.
  {
    name: "a payment card number",
    re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/,
    verify: (m) => luhn(m.replace(/\D/g, "")),
  },
  {
    name: "an IBAN",
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/,
    verify: (m) => ibanValid(m.replace(/ /g, "")),
  },
  {
    name: "a bank account number",
    re: /\b(?:account|acct|cuenta)\b(?: (?:number|no|num|n[uú]mero|bancaria))?[\s.:#]{0,4}\d[\d -]{7,20}\d\b/i,
  },
];

/** The first credential-looking thing on each line: its 1-based line and what it looks like. */
export function findSecrets(text: string): { line: number; what: string }[] {
  const found: { line: number; what: string }[] = [];
  text.split("\n").forEach((line, i) => {
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (m && (p.verify === undefined || p.verify(m[0]))) {
        found.push({ line: i + 1, what: p.name });
        break;
      }
    }
  });
  return found;
}

/** The names of the patterns, for documentation and tests. */
export const SECRET_PATTERN_NAMES: readonly string[] = PATTERNS.map((p) => p.name);
