/**
 * Authentik OIDC configuration and discovery.
 *
 * The app is a confidential OIDC client: it runs the authorization-code flow
 * with PKCE against Authentik, and verifies the returned ID token's signature
 * against Authentik's published JWKS before trusting anything in it. That is
 * what makes this a verified credential rather than a header someone could
 * set — the gate stands up on its own, whatever the proxy in front does.
 *
 * Group membership is enforced in Authentik, by binding the mentors group to
 * the application: a non-member is refused at the authorization step and never
 * receives a code, so the flow below simply fails for them. `REQUIRE_GROUP` is
 * available as a second, in-app check and is off by default — see the README.
 */

import * as oidc from 'openid-client';

/** Scopes requested. `groups` is what Authentik maps the group claim onto. */
const SCOPES = 'openid profile email groups';

/**
 * Read auth settings from the environment.
 *
 * @returns {{ configured: boolean, missing: string[], issuer: string,
 *   clientId: string, clientSecret: string, redirectUri: string,
 *   sessionSecret: string, requireGroup: string, devBypass: boolean,
 *   cookieSecure: boolean, postLogoutRedirect: string }}
 */
export function readAuthConfig(env = process.env) {
  const issuer = env.OIDC_ISSUER ?? '';
  const clientId = env.OIDC_CLIENT_ID ?? '';
  const clientSecret = env.OIDC_CLIENT_SECRET ?? '';
  const redirectUri = env.OIDC_REDIRECT_URI ?? '';
  const sessionSecret = env.SESSION_SECRET ?? '';

  const missing = [];
  if (!issuer) missing.push('OIDC_ISSUER');
  if (!clientId) missing.push('OIDC_CLIENT_ID');
  if (!clientSecret) missing.push('OIDC_CLIENT_SECRET');
  if (!redirectUri) missing.push('OIDC_REDIRECT_URI');
  if (!sessionSecret) missing.push('SESSION_SECRET');

  return {
    configured: missing.length === 0,
    missing,
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    /** Optional in-app group gate. Empty means "rely on Authentik's binding". */
    requireGroup: env.REQUIRE_GROUP ?? '',
    /**
     * Local-development escape hatch. Defaults to off, is purpose-named rather
     * than keyed off NODE_ENV, and is refused outright unless the server is
     * bound to loopback — see auth/requireAuth.js.
     */
    devBypass: env.AUTH_DEV_BYPASS === 'true',
    /** Cookies are Secure unless explicitly relaxed for plain-HTTP loopback. */
    cookieSecure: env.AUTH_COOKIE_INSECURE !== 'true',
    postLogoutRedirect: env.OIDC_POST_LOGOUT_REDIRECT ?? '',
  };
}

/**
 * Discover the provider and build an openid-client Configuration.
 *
 * Discovery is done once at first use and cached: it is a network call to
 * Authentik, and the metadata does not change between restarts.
 */
export class OidcProvider {
  /** @param {ReturnType<typeof readAuthConfig>} config */
  constructor(config) {
    this.config = config;
    this._configuration = null;
    this._discovery = null;
  }

  /**
   * True when the issuer is plain HTTP on loopback.
   *
   * openid-client refuses non-HTTPS issuers, correctly — a token exchanged
   * over plain HTTP is readable in transit. The single exception worth making
   * is an issuer on this machine, which is how the test suite runs the real
   * library end-to-end against a fake provider. Anything non-loopback stays
   * refused, so this cannot be turned into "just disable TLS in production".
   *
   * @returns {boolean}
   */
  _isLoopbackHttpIssuer() {
    try {
      const url = new URL(this.config.issuer);
      if (url.protocol !== 'http:') return false;
      return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    } catch {
      return false;
    }
  }

  /**
   * @returns {Promise<oidc.Configuration>}
   */
  async configuration() {
    if (this._configuration) return this._configuration;

    /**
     * `enableNonRepudiationChecks` makes openid-client verify the ID token's
     * signature against Authentik's JWKS.
     *
     * It is off by default, and that default is spec-compliant: OIDC Core
     * 3.1.3.7 lets a client skip the signature check when the token arrives
     * over a direct, TLS-protected, client-authenticated call to the token
     * endpoint, which is what the code flow does. We turn it on anyway,
     * because this is an access gate and verifying the signature costs one
     * cached JWKS fetch. Without it a token minted by anything that could
     * answer as the token endpoint would be taken at face value.
     */
    const execute = [oidc.enableNonRepudiationChecks];

    // Plain-HTTP loopback is only ever the test provider; see above.
    if (this._isLoopbackHttpIssuer()) execute.push(oidc.allowInsecureRequests);

    const options = { execute };

    // Share one in-flight discovery between concurrent first requests.
    if (!this._discovery) {
      this._discovery = oidc.discovery(
        new URL(this.config.issuer),
        this.config.clientId,
        this.config.clientSecret,
        undefined,
        options,
      ).then((result) => {
        this._configuration = result;
        return result;
      }).catch((err) => {
        // Let the next request retry rather than caching the failure.
        this._discovery = null;
        throw new Error(
          `Could not reach Authentik at ${this.config.issuer}: ${err.message}. `
          + 'Check OIDC_ISSUER — it should be the provider URL ending in /application/o/<slug>/',
        );
      });
    }

    return this._discovery;
  }

  /**
   * Begin a login: returns the URL to send the browser to, plus the handshake
   * values that must come back to verify the response.
   *
   * @param {string} returnTo  Path to land on after login
   * @returns {Promise<{ url: string, handshake: object }>}
   */
  async startLogin(returnTo) {
    const configuration = await this.configuration();

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.redirectUri,
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    return {
      url: url.href,
      handshake: { codeVerifier, state, nonce, returnTo },
    };
  }

  /**
   * Complete a login: exchange the code and verify the ID token.
   *
   * openid-client checks the signature against the provider's JWKS and
   * validates issuer, audience, expiry, state and nonce. A failure here means
   * the response was not a genuine Authentik response for this client, so it
   * throws rather than returning a partial identity.
   *
   * @param {URL} currentUrl  The full callback URL as received
   * @param {{ codeVerifier: string, state: string, nonce: string }} handshake
   * @returns {Promise<{ sub: string, name: string, email: string, username: string, groups: string[] }>}
   */
  async completeLogin(currentUrl, handshake) {
    const configuration = await this.configuration();

    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: handshake.codeVerifier,
      expectedState: handshake.state,
      expectedNonce: handshake.nonce,
    });

    const claims = tokens.claims();
    if (!claims?.sub) {
      throw new Error('Authentik returned an ID token with no subject');
    }

    return {
      sub: claims.sub,
      name: claims.name ?? claims.preferred_username ?? claims.sub,
      email: claims.email ?? '',
      username: claims.preferred_username ?? '',
      groups: Array.isArray(claims.groups) ? claims.groups : [],
    };
  }

  /**
   * URL that ends the Authentik session too, so logging out of the app is not
   * silently undone by the next redirect. Returns null when the provider does
   * not advertise an end-session endpoint.
   *
   * @returns {Promise<string|null>}
   */
  async endSessionUrl() {
    const configuration = await this.configuration();
    if (!configuration.serverMetadata().end_session_endpoint) return null;

    const params = {};
    if (this.config.postLogoutRedirect) {
      params.post_logout_redirect_uri = this.config.postLogoutRedirect;
    }

    return oidc.buildEndSessionUrl(configuration, params).href;
  }
}
