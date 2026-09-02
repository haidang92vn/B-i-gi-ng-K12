# Google sign-in (OpenID Connect)

The application supports **server-side Google OpenID Connect**, not collection of a Gmail
password. The browser is redirected to Google; the backend uses a short-lived HttpOnly state
cookie, PKCE, a nonce and server-side ID-token verification. No Google access token, refresh token
or Gmail password is persisted.

## Google Cloud setup

1. In the school's Google Cloud project, configure the OAuth consent screen and create an OAuth
   client of type **Web application**.
2. Add the exact production redirect URI on the **frontend** hostname:
   `https://studio.YOUR_DOMAIN/api/v1/auth/google/callback`. With Vercel, this is the Vercel
   production domain until a school domain is assigned. The scheme, host, path and trailing slash
   must exactly match the configured URI.
3. Keep the Client ID and Client Secret in the VPS `.env` only:

   ```text
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=...
   GOOGLE_OAUTH_REDIRECT_URI=https://studio.YOUR_DOMAIN/api/v1/auth/google/callback
   ```

4. For the first-school bootstrap only, set the exact verified Google email and the school name in
   the same VPS secret file:

   ```text
   GOOGLE_BOOTSTRAP_ADMIN_EMAIL=authorized-admin@example.edu.vn
   GOOGLE_BOOTSTRAP_SCHOOL_NAME=Trường Tiểu học Trần Quốc Toản
   ```

   Replace the email with the designated administrator's verified address at deployment time. Do
   not commit it if it is personal data. On that account's first successful Google login, the
   service creates/ensures its `school_admin` membership. Remove both bootstrap variables after a
   second administrator is verified, unless deliberately retaining this recovery path.

## Security contract

- Google verifies the account; this app never sees or verifies a Gmail password.
- The backend verifies the ID token signature, issuer, audience, expiry, nonce and verified email.
- The stable Google `sub` claim is stored in `oauth_identities`; provider tokens are not stored.
- If an existing local email/password account has the same verified email, its Google identity is
  linked once. A different Google subject cannot take that account merely by submitting an email.
- The callback is HTTPS in production. Redirect/state mismatch, cancellation and token failures
  return to the login screen without disclosing token details.

Google requires the redirect URI to exactly match an authorized URI, and its OIDC guidance requires
server-side ID token validation. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server)
and [Google OpenID Connect guidance](https://developers.google.com/identity/openid-connect/openid-connect).
