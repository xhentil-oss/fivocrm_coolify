/**
 * Email sender identity — the ONLY way a From / Reply-To header is built.
 *
 * Gmail shows "This message might be dangerous — the sender's email address uses
 * abnormal characters" whenever the From header carries anything it considers
 * spoof-like: HTML entities (`&#x27;`) left over from escapeHtml, emoji or symbols,
 * invisible/format characters, mixed scripts, an `@` inside the display name, or a
 * sender ADDRESS that is not a plain ASCII mailbox (an env value pasted with its
 * quotes, a `Name <addr>` string, trailing whitespace…). One warning like that and
 * every invoice, invite and campaign from the tenant lands in the danger zone.
 *
 * Rules:
 *   - a display name keeps Latin letters (ë, ç, é… included), digits, space and a
 *     small punctuation set; everything else becomes a space and is collapsed. An
 *     empty result falls back to the platform brand, never to an empty string.
 *   - an address must be a plain ASCII mailbox. Anything else is `undefined`, so
 *     the caller falls back to the platform SMTP user instead of sending garbage.
 *   - never HTML-escape a header value; never hand-quote a name yourself — use
 *     `senderHeader()` or nodemailer's `{ name, address }` form.
 *
 * `src/lib/emailIdentity.ts` is the browser MIRROR (Settings + campaign form show
 * the exact From the recipient will see). `src/lib/emailIdentity.test.ts` fails the
 * run if the two drift — `api/` must never import from `src/`.
 */

export const PLATFORM_SENDER_NAME = 'FivoCRM';
export const SENDER_NAME_MAX = 64;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
};

/** `&#x27;` / `&#39;` / `&amp;` → the character they stand for (so it can then be filtered). */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ' ';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? ' ';
  });
}

// Latin letters (+ combining marks for the rare decomposed input), digits, space
// and punctuation that is harmless in a quoted display name. No `"`, `\`, `<`, `>`,
// `@`, `;`, `:` — the characters that let a name imitate an address or break the
// header — and no symbols/emoji, which is what trips the Gmail warning.
const NAME_ALLOWED = /[^\p{Script=Latin}\p{M}0-9 .,'&()+/_!-]/gu;

/**
 * Header-safe display name. Idempotent; never returns an empty string.
 * `safeSenderName('Ekipi FivoCRM ✅')` → `'Ekipi FivoCRM'`,
 * `safeSenderName('Mario &#x27;M&#x27;')` → `"Mario 'M'"`,
 * `safeSenderName('🚀🚀')` → `'FivoCRM'`.
 */
export function safeSenderName(raw: unknown, fallback: string = PLATFORM_SENDER_NAME): string {
  const decoded = decodeEntities(String(raw ?? '')).normalize('NFKC');
  const kept = decoded.replace(NAME_ALLOWED, ' ').replace(/\s+/g, ' ').trim();
  const cut = kept.length > SENDER_NAME_MAX ? kept.slice(0, SENDER_NAME_MAX).replace(/\s+\S*$/, '').trim() : kept;
  // A name made only of punctuation ("...", "-") is not a name.
  if (!/[\p{L}0-9]/u.test(cut)) return fallback;
  return cut;
}

// RFC 5322 addr-spec, ASCII only, no quoted local part, at least one dot in the domain.
const ADDRESS_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * Plain ASCII mailbox or `undefined`. Tolerates the two common env/config mistakes
 * — a value pasted WITH its quotes (`"crm@x.net"`) and a full `Name <addr>` header —
 * and refuses everything else (non-ASCII, spaces, a missing domain, two `@`).
 * Case is preserved: the same value is also the SMTP login on most hosts.
 */
export function safeSenderAddress(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  const angle = s.match(/<([^<>]*)>\s*$/);
  if (angle) s = angle[1].trim();
  s = s.replace(/^["']+|["']+$/g, '').trim();
  if (!s || s.length > 254 || !ADDRESS_RE.test(s)) return undefined;
  return s;
}

/**
 * The `"Name" <addr>` string for providers that take a single header value
 * (Resend, Mailgun, the string form of nodemailer). `name` goes through
 * `safeSenderName`, so the quoted-string can never be broken by a `"` or `\`.
 */
export function senderHeader(name: unknown, address: string, fallbackName: string = PLATFORM_SENDER_NAME): string {
  return `"${safeSenderName(name, fallbackName)}" <${address}>`;
}

/** Why a typed display name will not be sent as-is (UI hint); `null` when it is fine. */
export function senderNameIssue(raw: unknown): 'empty' | 'altered' | null {
  const s = String(raw ?? '').trim();
  if (!s) return 'empty';
  return safeSenderName(s, '') === s ? null : 'altered';
}
