import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
import {
  type AuthStore,
  ChatGPTError,
  type Fetch,
  ISSUER,
  PLAN_SCOPE,
  RESOURCE,
  tokenRequest,
  tokens,
} from './auth.ts';

const random = (): string => randomBytes(32).toString('base64url');
export const CALLBACK = 'http://127.0.0.1:1455/auth/callback';

export interface Attempt {
  state: string;
  nonce: string;
  verifier: string;
  client: string;
}

export function authorization(attempt: Attempt, host: string): string {
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: attempt.client,
    ext_agent_host_id: host,
    response_type: 'code',
    redirect_uri: CALLBACK,
    resource: RESOURCE,
    scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
    ...(attempt.client === 'dynamic_agent_client' ? { agent_name_hint: 'Geldar Scriptorium' } : {}),
  }).toString();
  // Do not add id_token_hint: the URL is displayed for the human to open, never containing credentials.
  return url.toString();
}

export function callback(url: URL, attempt: Attempt): { code: string; client: string } {
  if (
    url.pathname !== '/auth/callback' ||
    url.searchParams.getAll('state').length !== 1 ||
    url.searchParams.get('state') !== attempt.state
  )
    throw new ChatGPTError('ChatGPT callback could not be verified.');
  if (url.searchParams.has('error')) throw new ChatGPTError('ChatGPT sign-in was declined.');
  const code = url.searchParams.get('code');
  const client = url.searchParams.get('client_id') ?? attempt.client;
  if (
    !code ||
    url.searchParams.getAll('code').length !== 1 ||
    url.searchParams.getAll('client_id').length > 1 ||
    client === 'dynamic_agent_client' ||
    !/^oaiapp_[A-Za-z0-9_-]+$/.test(client) ||
    (attempt.client !== 'dynamic_agent_client' && client !== attempt.client)
  ) {
    throw new ChatGPTError('Incomplete or mismatched ChatGPT registration.');
  }
  return { code, client };
}

/** Signature, issuer, audience, expiry, nonce and returning-account identity must all match. */
export async function finishLogin(
  store: AuthStore,
  attempt: Attempt,
  url: URL,
  request: Fetch = fetch,
): Promise<void> {
  const { code, client } = callback(url, attempt);
  const reg = store.registration();
  // Retain registration even if the one-time code expires; credentials change only after validation.
  store.write('registration.json', { ...reg, client });
  const data = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: CALLBACK,
      resource: RESOURCE,
    }),
    request,
  );
  if (typeof data.id_token !== 'string')
    throw new ChatGPTError('ChatGPT returned no verifiable identity.');
  const res = await request(`${ISSUER}/.well-known/jwks.json`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ChatGPTError('ChatGPT identity keys are unavailable.');
  const jwks = createLocalJWKSet((await res.json()) as Parameters<typeof createLocalJWKSet>[0]);
  const { payload } = await jwtVerify(data.id_token, jwks, {
    issuer: ISSUER,
    audience: client,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat'],
    clockTolerance: 5,
  });
  if (
    payload.nonce !== attempt.nonce ||
    !payload.sub ||
    (reg.subject && reg.subject !== payload.sub)
  ) {
    throw new ChatGPTError('ChatGPT identity did not match this player login.');
  }
  const saved = tokens(data, {
    client,
    subject: payload.sub,
    id: data.id_token,
    refresh: '',
    scopes: [],
  });
  store.write('registration.json', { ...reg, client, subject: payload.sub });
  store.write('credentials.json', saved);
}

/** The container publishes this listener on the host's loopback interface only. */
export async function login(store: AuthStore, show: (line: string) => void): Promise<void> {
  await store.locked(async () => {
    const reg = store.registration();
    const attempt: Attempt = {
      state: random(),
      nonce: random(),
      verifier: random(),
      client: reg.client ?? 'dynamic_agent_client',
    };
    let settle: (url: URL) => void = () => {};
    let reject: (err: Error) => void = () => {};
    const result = new Promise<URL>((resolve, fail) => {
      settle = resolve;
      reject = fail;
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', CALLBACK);
      if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get('state') !== attempt.state) {
        res.writeHead(400).end('Invalid sign-in state.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
      });
      res.end('Return to the terminal to check whether ChatGPT sign-in completed.');
      settle(url);
    });
    server.on('error', () =>
      reject(new ChatGPTError('ChatGPT callback port 1455 is unavailable.')),
    );
    const timer = setTimeout(
      () => reject(new ChatGPTError('ChatGPT sign-in timed out.')),
      5 * 60_000,
    );
    try {
      server.listen(1455, '0.0.0.0', () => {
        show(
          'Continue with ChatGPT: open this URL in your browser and approve ChatGPT plan usage.',
        );
        show(authorization(attempt, reg.host));
      });
      await finishLogin(store, attempt, await result);
      show('ChatGPT connected. Manage app usage at https://chatgpt.com/settings/usage');
    } finally {
      clearTimeout(timer);
      server.closeAllConnections();
      server.close();
    }
  });
}
