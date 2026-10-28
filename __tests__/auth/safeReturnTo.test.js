import { safeReturnTo } from '../../src/server/routes/authRoutes.js';

/**
 * `returnTo` comes straight off the query string and is handed to res.redirect
 * after login, so without this the login endpoint would be an open redirect —
 * a phishing primitive on a domain users are trained to sign in to.
 */
describe('safeReturnTo', () => {
  it('keeps a rooted path', () => {
    expect(safeReturnTo('/purchasing')).toBe('/purchasing');
    expect(safeReturnTo('/receiving?x=1')).toBe('/receiving?x=1');
  });

  it('refuses a protocol-relative URL', () => {
    expect(safeReturnTo('//evil.example.com')).toBe('/');
    expect(safeReturnTo('//evil.example.com/path')).toBe('/');
  });

  it('refuses an absolute URL', () => {
    expect(safeReturnTo('https://evil.example.com')).toBe('/');
    expect(safeReturnTo('http://evil.example.com')).toBe('/');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('refuses a bare path with no leading slash', () => {
    expect(safeReturnTo('purchasing')).toBe('/');
  });

  it('defaults to the root for missing input', () => {
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo('')).toBe('/');
  });
});
