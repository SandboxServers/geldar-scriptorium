import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export type Fetch = typeof fetch;

/** Deliberately carries no response body, URL or token in an error message. */
export class ChatGPTError extends Error {}

export interface Registration {
  host: string;
  client?: string;
  subject?: string;
}

export interface Credentials {
  client: string;
  subject: string;
  access: string;
  refresh: string;
  id: string;
  scopes: string[];
  expires: number;
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** CLI home is never mounted in a tool server. No path here is supplied by the model. */
export class AuthStore {
  readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, 'chatgpt');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(this.dir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new ChatGPTError('Unsafe login directory.');
    chmodSync(this.dir, 0o700);
  }

  read(name: string): unknown {
    const file = join(this.dir, name);
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st) return null;
    if (!st.isFile() || st.nlink !== 1 || (process.platform !== 'win32' && st.mode & 0o077)) {
      throw new ChatGPTError('Unsafe login file.');
    }
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  }

  write(name: string, value: unknown): void {
    const file = join(this.dir, name);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
  }

  registration(): Registration {
    const r = this.read('registration.json');
    if (r === null) {
      const fresh = { host: `urn:uuid:${randomUUID()}` };
      this.write('registration.json', fresh);
      return fresh;
    }
    if (!record(r) || typeof r.host !== 'string' || !r.host.startsWith('urn:uuid:')) {
      throw new ChatGPTError('Invalid ChatGPT registration.');
    }
    if (
      r.client !== undefined &&
      (typeof r.client !== 'string' || r.client === 'dynamic_agent_client')
    ) {
      throw new ChatGPTError('Invalid ChatGPT registration.');
    }
    if (r.subject !== undefined && typeof r.subject !== 'string') {
      throw new ChatGPTError('Invalid ChatGPT registration.');
    }
    return r as unknown as Registration;
  }

  credentials(): Credentials {
    const r = this.read('credentials.json');
    if (
      !record(r) ||
      !['client', 'subject', 'access', 'refresh', 'id'].every(
        (k) => typeof r[k] === 'string' && r[k] !== '',
      ) ||
      !Array.isArray(r.scopes) ||
      !r.scopes.every((s) => typeof s === 'string') ||
      typeof r.expires !== 'number' ||
      !Number.isFinite(r.expires)
    ) {
      throw new ChatGPTError('Run geldar-play chatgpt-login for this player first.');
    }
    const reg = this.registration();
    if (r.client !== reg.client || r.subject !== reg.subject)
      throw new ChatGPTError('ChatGPT registration mismatch.');
    return r as unknown as Credentials;
  }

  /** Also prevents a login/model-list process racing a rotating refresh token. */
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    const lock = join(this.dir, 'lock');
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw new ChatGPTError(
        'ChatGPT login is in use. Retry after the current round, or stop the player before signing in.',
      );
    }
    try {
      return await fn();
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
}

export async function tokenRequest(
  body: URLSearchParams,
  request: Fetch,
): Promise<Record<string, unknown>> {
  const res = await request(TOKEN_URL, {
    method: 'POST',
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new ChatGPTError(
      `ChatGPT authorization failed (HTTP ${res.status}). Sign in again if access was revoked.`,
    );
  const data: unknown = await res.json();
  if (!record(data)) throw new ChatGPTError('Invalid ChatGPT token response.');
  return data;
}

export function tokens(
  data: Record<string, unknown>,
  old: Pick<Credentials, 'client' | 'subject' | 'id' | 'refresh' | 'scopes'>,
): Credentials {
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    data.token_type !== 'Bearer' ||
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  ) {
    throw new ChatGPTError('Invalid ChatGPT token response.');
  }
  const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/) : old.scopes;
  if (!scopes.includes(PLAN_SCOPE))
    throw new ChatGPTError('ChatGPT plan usage was not granted. Sign in and enable it.');
  const refresh = typeof data.refresh_token === 'string' ? data.refresh_token : old.refresh;
  if (!refresh) throw new ChatGPTError('ChatGPT did not grant a renewable session.');
  return {
    ...old,
    access: data.access_token,
    refresh,
    scopes,
    expires: Date.now() + data.expires_in * 1000,
  };
}

/** All callers use the same file lock; failed refreshes preserve the previous credentials. */
export async function accessToken(store: AuthStore, request: Fetch = fetch): Promise<string> {
  return store.locked(async () => {
    const saved = store.credentials();
    if (!saved.scopes.includes(PLAN_SCOPE))
      throw new ChatGPTError('ChatGPT plan usage is not enabled.');
    if (saved.expires > Date.now() + 60_000) return saved.access;
    const data = await tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: saved.client,
        refresh_token: saved.refresh,
        resource: RESOURCE,
      }),
      request,
    );
    const next = tokens(data, saved);
    store.write('credentials.json', next);
    return next.access;
  });
}

export async function models(
  store: AuthStore,
  request: Fetch = fetch,
): Promise<{ slug: string; display_name: string }[]> {
  const access = await accessToken(store, request);
  const res = await request(`${RESOURCE}/models`, {
    headers: { Authorization: `Bearer ${access}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ChatGPTError(`ChatGPT model listing failed (HTTP ${res.status}).`);
  const data: unknown = await res.json();
  if (!record(data) || !Array.isArray(data.models))
    throw new ChatGPTError('Invalid ChatGPT model catalog.');
  return data.models.filter(
    (m): m is { slug: string; display_name: string } =>
      record(m) &&
      m.visibility === 'list' &&
      typeof m.slug === 'string' &&
      typeof m.display_name === 'string',
  );
}
