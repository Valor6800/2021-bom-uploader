import {
  sealCookie,
  openCookie,
  serializeCookie,
  parseCookies,
  CookieType,
} from '../../src/server/auth/session.js';

const SECRET = 'test-secret-do-not-use';
const future = () => Math.floor(Date.now() / 1000) + 600;

describe('sealCookie / openCookie', () => {
  it('round-trips a payload', () => {
    const payload = { sub: 'abc', name: 'Nik Olsen', groups: ['valor mentors'], exp: future() };
    const opened = openCookie(sealCookie(payload, SECRET, CookieType.SESSION), SECRET, CookieType.SESSION);

    expect(opened).toMatchObject(payload);
    expect(opened.typ).toBe(CookieType.SESSION);
  });

  it('rejects a payload whose contents were altered', () => {
    // The whole point: a user must not be able to add themselves to a group.
    const sealed = sealCookie({ sub: 'abc', groups: [], exp: future() }, SECRET, CookieType.SESSION);
    const [body, signature] = sealed.split('.');

    const forged = Buffer.from(
      JSON.stringify({ sub: 'abc', groups: ['valor mentors'], exp: future() }),
    ).toString('base64url');

    expect(openCookie(`${forged}.${signature}`, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('rejects a cookie signed with a different secret', () => {
    const sealed = sealCookie({ sub: 'abc', exp: future() }, 'another-secret', CookieType.SESSION);
    expect(openCookie(sealed, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('rejects an expired payload', () => {
    const sealed = sealCookie({ sub: 'abc', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET, CookieType.SESSION);
    expect(openCookie(sealed, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('rejects a payload with no expiry, rather than treating it as eternal', () => {
    const sealed = sealCookie({ sub: 'abc' }, SECRET, CookieType.SESSION);
    expect(openCookie(sealed, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const value of [undefined, null, '', 'nonsense', '.', 'a.', '.b', 42, {}]) {
      expect(openCookie(value, SECRET, CookieType.SESSION)).toBeNull();
    }
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // Guards the timingSafeEqual length precondition.
    const sealed = sealCookie({ sub: 'abc', exp: future() }, SECRET, CookieType.SESSION);
    const body = sealed.split('.')[0];
    expect(openCookie(`${body}.short`, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('tolerates a base64url payload containing a dot-free signature boundary', () => {
    const payload = { sub: 'a.b.c', exp: future() };
    expect(openCookie(sealCookie(payload, SECRET, CookieType.SESSION), SECRET, CookieType.SESSION))
      .toMatchObject(payload);
  });
});

describe('cookie purpose enforcement', () => {
  /**
   * The bug this prevents: both cookies are sealed with the same secret, and
   * /auth/login hands a sealed handshake cookie to any anonymous caller. With
   * no type claim, replaying it as the session cookie passed the gate — a
   * complete authentication bypass.
   */
  it('refuses a handshake cookie presented as a session', () => {
    const handshake = sealCookie(
      { codeVerifier: 'v', state: 's', nonce: 'n', returnTo: '/', exp: future() },
      SECRET,
      CookieType.OIDC_STATE,
    );

    expect(openCookie(handshake, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('refuses a session cookie presented as a handshake', () => {
    const session = sealCookie({ sub: 'u1', exp: future() }, SECRET, CookieType.SESSION);
    expect(openCookie(session, SECRET, CookieType.OIDC_STATE)).toBeNull();
  });

  it('still accepts each cookie for its own purpose', () => {
    const session = sealCookie({ sub: 'u1', exp: future() }, SECRET, CookieType.SESSION);
    const handshake = sealCookie({ state: 's', exp: future() }, SECRET, CookieType.OIDC_STATE);

    expect(openCookie(session, SECRET, CookieType.SESSION)).toMatchObject({ sub: 'u1' });
    expect(openCookie(handshake, SECRET, CookieType.OIDC_STATE)).toMatchObject({ state: 's' });
  });

  it('refuses a payload with a forged typ claim, since typ is signed', () => {
    const sealed = sealCookie({ sub: 'u1', exp: future() }, SECRET, CookieType.OIDC_STATE);
    const [, signature] = sealed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'u1', exp: future(), typ: CookieType.SESSION }),
    ).toString('base64url');

    expect(openCookie(`${forged}.${signature}`, SECRET, CookieType.SESSION)).toBeNull();
  });

  it('refuses to seal or open without a stated purpose', () => {
    expect(() => sealCookie({ sub: 'u1', exp: future() }, SECRET)).toThrow(/cookie type/);
    expect(() => openCookie('x.y', SECRET)).toThrow(/cookie type/);
  });
});

describe('serializeCookie', () => {
  it('is HttpOnly, SameSite=Lax and Secure by default', () => {
    const header = serializeCookie({ name: 'x', value: 'y', maxAgeSeconds: 60 });

    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=60');
  });

  it('can drop Secure for plain-HTTP loopback development', () => {
    expect(serializeCookie({ name: 'x', value: 'y', secure: false })).not.toContain('Secure');
  });

  it('expires immediately when told to', () => {
    const header = serializeCookie({ name: 'x', value: '', maxAgeSeconds: 0 });
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('parseCookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('keeps values containing an equals sign intact', () => {
    expect(parseCookies('token=abc.def=ghi')).toEqual({ token: 'abc.def=ghi' });
  });

  it('handles an absent or empty header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});
