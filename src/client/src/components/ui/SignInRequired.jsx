/**
 * Shown when a mentor-only page is reached without a session.
 *
 * Deliberately a prompt rather than an automatic redirect: arriving here means
 * the user clicked through from a public page, and bouncing them to an identity
 * provider without a word is disorienting — and loops badly if the sign-in
 * itself fails. A direct link or bookmark never reaches this, because the
 * server gates those documents and redirects before the app loads.
 */

import Card from './Card.jsx';
import Button from './Button.jsx';

export default function SignInRequired({ title, forbidden = false, message, returnTo }) {
  const loginUrl = `/auth/login?returnTo=${encodeURIComponent(returnTo ?? '/')}`;

  return (
    <Card title={title} icon={forbidden ? '⛔' : '🔒'}>
      <div className="card-body">
        {forbidden ? (
          <>
            <p className="text-light mb-4">
              You are signed in, but this is limited to mentors.
            </p>
            {message && <p className="text-dim mb-4">{message}</p>}
            <Button variant="secondary" onClick={() => { window.location.href = '/auth/logout'; }}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="text-light mb-4">
              Parts ordering is limited to mentors. Sign in to continue.
            </p>
            <Button onClick={() => { window.location.href = loginUrl; }}>
              Sign in with Authentik
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
