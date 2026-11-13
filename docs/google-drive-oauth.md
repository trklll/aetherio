# Google Drive OAuth release configuration

Aetherio uses Google's **Desktop app** OAuth client type, PKCE, and a temporary
loopback callback on `127.0.0.1`. The public client ID has a source fallback.

Google documents the desktop client secret as optional and states that desktop
apps cannot keep secrets confidential. Aetherio supports the secret only for
OAuth clients whose token exchange explicitly requires it. Because this is a
desktop application, a configured value is included in the compiled app and is
recoverable; do not reuse a credential that must remain confidential.

For a local build, add the following to the ignored `.env.local` file:

```dotenv
VITE_GDRIVE_CLIENT_SECRET=your-desktop-oauth-client-secret
```

For a release built with `scripts/publish-release.ps1`, set
`VITE_GDRIVE_CLIENT_SECRET` in the shell environment before running the script.
The script's `npm run tauri build` inherits that environment. Do not commit
`.env.local` or put the value in source control. If the client is configured
as a **Web application**, create/select a **Desktop app** OAuth client instead
of relying on a bundled web-client secret.
