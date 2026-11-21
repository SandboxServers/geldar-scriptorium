/**
 * A conservative token count: one token per three UTF-8 bytes. English runs about four characters per
 * token, so this overestimates, and non-ASCII text counts by its bytes.
 */
export const estimateTokens = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, 'utf8') / 3);

/** The estimate charged for one image in a request. */
export const IMAGE_TOKENS = 1600;

/** Tokens each message adds on top of its own text (the role and the separators). */
export const MESSAGE_OVERHEAD = 8;

/** The room kept for the reply: a quarter of the context, at most 2048 tokens. */
export const outputReserve = (contextTokens: number): number =>
  Math.min(2048, Math.floor(contextTokens / 4));
