import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthStore,
  accessToken,
  type Credentials,
  type Fetch,
  ISSUER,
  models,
  PLAN_SCOPE,
  TOKEN_URL,
} from './auth.ts';
import { type Attempt, authorization, callback, finishLogin } from './login.ts';

const roots: string[] = [];
function store(): AuthStore {
  const root = mkdtempSync(join(tmpdir(), 'geldar-chatgpt-'));
  roots.push(root);
  return new AuthStore(root);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function saved(s: AuthStore, expires = Date.now() + 3600_000): Credentials {
  s.write('registration.json', {
    host: 'urn:uuid:test',
    client: 'oaiapp_test',
    subject: 'test-subject',
  });
  const value = {
    client: 'oaiapp_test',
    subject: 'test-subject',
    access: 'access-sentinel',
    refresh: 'refresh-sentinel',
    id: 'id-sentinel',
    scopes: [PLAN_SCOPE],
    expires,
  };
  s.write('credentials.json', value);
  return value;
}
const attempt: Attempt = {
  state: 'test-state',
  nonce: 'test-nonce',
  verifier: 'test-verifier',
  client: 'dynamic_agent_client',
};
const returned = (query = '') =>
  new URL(
    `http://127.0.0.1:1455/auth/callback?state=test-state&code=test-code&client_id=oaiapp_test${query}`,
  );

describe('ChatGPT authorization and storage', () => {
  it('persists the host and constructs a public PKCE request with plan consent, without token hints', () => {
    const s = store();
    const host = s.registration().host;
    expect(new AuthStore(join(s.dir, '..')).registration().host).toBe(host);
    const url = new URL(authorization(attempt, host));
    expect(url.origin).toBe(ISSUER);
    expect(url.searchParams.get('ext_agent_host_id')).toBe(host);
    expect(url.searchParams.get('scope')).toContain(PLAN_SCOPE);
    expect(url.searchParams.get('code_challenge')).not.toBe(attempt.verifier);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(
      new URL(authorization({ ...attempt, client: 'oaiapp_test' }, host)).searchParams.has(
        'agent_name_hint',
      ),
    ).toBe(false);
  });

  it.each(['&state=wrong', '&error=access_denied', '&client_id=oaiapp_other', '&code=duplicate'])(
    'refuses ambiguous or declined callbacks (%s)',
    (query) => {
      expect(() => callback(returned(query), attempt)).toThrow();
    },
  );

  it('requires the saved registration on reauthorization', () => {
    expect(() => callback(returned(), { ...attempt, client: 'oaiapp_other' })).toThrow(
      'mismatched',
    );
    expect(
      callback(new URL('http://127.0.0.1:1455/auth/callback?state=test-state&code=x'), {
        ...attempt,
        client: 'oaiapp_test',
      }).client,
    ).toBe('oaiapp_test');
  });

  it('verifies signed identity before storing credentials, and rejects nonce, subject and signature changes', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    for (const variant of ['ok', 'nonce', 'subject', 'signature', 'audience', 'scope']) {
      const s = store();
      saved(s);
      const signingKey =
        variant === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey;
      const id = await new SignJWT({ nonce: variant === 'nonce' ? 'wrong' : attempt.nonce })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(ISSUER)
        .setSubject(variant === 'subject' ? 'other-subject' : 'test-subject')
        .setAudience(variant === 'audience' ? 'oaiapp_wrong' : 'oaiapp_test')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(signingKey);
      const request = vi.fn(async (url) =>
        Response.json(
          String(url) === TOKEN_URL
            ? {
                access_token: 'new-access',
                refresh_token: 'new-refresh',
                id_token: id,
                token_type: 'Bearer',
                expires_in: 3600,
                scope: variant === 'scope' ? 'openid' : PLAN_SCOPE,
              }
            : { keys: [jwk] },
        ),
      ) as unknown as Fetch;
      const work = finishLogin(s, { ...attempt, client: 'oaiapp_test' }, returned(), request);
      if (variant === 'ok') {
        await work;
        expect(s.credentials().access).toBe('new-access');
      } else {
        await expect(work).rejects.toThrow();
        expect(s.credentials().access).toBe('access-sentinel');
      }
    }
  });

  it('retains issued registration when a code exchange fails, without saving tokens', async () => {
    const s = store();
    const request = vi.fn(
      async () => new Response('secret response body', { status: 400 }),
    ) as unknown as Fetch;
    await expect(finishLogin(s, attempt, returned(), request)).rejects.toThrow('HTTP 400');
    expect(s.registration().client).toBe('oaiapp_test');
    expect(() => s.credentials()).toThrow();
  });

  it('refreshes with the issued client and atomically retains the rotating refresh token', async () => {
    const s = store();
    saved(s, 0);
    const request = vi.fn(async (_url, init) => {
      expect(String(init?.body)).toContain('client_id=oaiapp_test');
      expect(String(init?.body)).not.toContain('scope=');
      return Response.json({
        access_token: 'next-access',
        refresh_token: 'next-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }) as unknown as Fetch;
    expect(await accessToken(s, request)).toBe('next-access');
    expect(s.credentials().refresh).toBe('next-refresh');
    await accessToken(s, request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refuses concurrent refreshes, preserves old tokens on failure, and never includes the response body in errors', async () => {
    const s = store();
    saved(s, 0);
    await s.locked(async () => {
      await expect(accessToken(s)).rejects.toThrow('in use');
    });
    const request = vi.fn(
      async () => new Response('refresh-sentinel', { status: 401 }),
    ) as unknown as Fetch;
    await expect(accessToken(s, request)).rejects.toThrow('HTTP 401');
    expect(s.credentials().refresh).toBe('refresh-sentinel');
    expect(readFileSync(join(s.dir, 'credentials.json'), 'utf8')).toContain('access-sentinel');
  });

  it('refuses identity-only credentials and exposes only visible account model choices', async () => {
    const s = store();
    const c = saved(s);
    s.write('credentials.json', { ...c, scopes: ['openid'] });
    await expect(accessToken(s)).rejects.toThrow('not enabled');
    s.write('credentials.json', c);
    const request = vi.fn(async () =>
      Response.json({
        models: [
          { slug: 'account-model', display_name: 'Account model', visibility: 'list' },
          { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
        ],
      }),
    ) as unknown as Fetch;
    expect(await models(s, request)).toEqual([
      { slug: 'account-model', display_name: 'Account model', visibility: 'list' },
    ]);
  });

  it.skipIf(process.platform === 'win32')('refuses group-readable token files', () => {
    const s = store();
    saved(s);
    chmodSync(join(s.dir, 'credentials.json'), 0o644);
    expect(() => s.credentials()).toThrow('Unsafe');
  });
});
