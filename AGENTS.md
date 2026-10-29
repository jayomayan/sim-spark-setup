<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Router work never runs in the app server: SNMP, NTP, UR35 config and existing helper ping jobs use `agent_jobs` and the on-network helper; Site Connectivity Check ping instead uses the dedicated connectivity service because this workflow must remain helper-free.
- Supported router jobs are defined in `src/lib/job-types.ts` and validated before queueing and dispatching so retired jobs cannot execute.
- Site Connectivity Check (formerly Private Browser; /private-browser stays as a redirect) captures and ping use a separate on-network service (`public/site-connectivity-service`) over authenticated HTTPS, not helper jobs; member-gated functions validate canonical RFC1918 IPs, and the service enforces CIDRs. Captures allow ports 80/443/8443/8080, with 8080 tried over HTTP then HTTPS because devices use either; Linux ping uses fixed four-probe arguments without a shell because private checks need network-local execution with bounded targets and runtime.
- Access is role-gated: data RLS requires a `user_roles` row (`is_member`); the first signup becomes admin and admins grant others through Admin Settings; /users remains a guarded compatibility URL.
- Admin Settings routes gate on the parent role context, and every settings server function independently validates the caller's admin role through RLS before any privileged work; managed database credentials are never returned.
- Alternate-database connection profiles live in `public.database_connections` (admin-only RLS); passwords are AES-256-GCM encrypted in `src/lib/db-connection.server.ts` with the `DB_SECRET_KEY` secret and are never returned to clients. Connection tests use a real Postgres handshake (`postgres` package); the app's own data always stays on the managed Lovable Cloud connection.
- External PostgreSQL setup runs only through an independently admin-authorized server function, creates missing databases through the postgres maintenance database, and applies versioned transactional tables in an isolated field_ops schema with owner-only access; this preserves unrelated tables and never clones managed auth or performs an implicit cutover.
- Okta/OIDC credentials are configured in the Lovable Cloud backend auth settings (Users → Auth settings → OIDC), never stored in the app; Admin Settings only checks sign-in status, reachable Okta domains, and shows the callback redirect URI.
- Console Connect configuration uses two admin-only rows in public.console_connect_settings for separate API destinations; all authentication fields resolve exclusively from Site ID Lookup and SIM saves cannot override them, preventing credential drift. Passwords reuse encrypted credential storage and are never returned or duplicated by SIM saves. Member-authorized operational functions load configuration through a server-only helper after is_member validation. Existing Site ID environment credentials remain the fallback until an admin saves the lookup row; edited destinations are restricted to official provider HTTPS domains and redirects are rejected to prevent credential forwarding.
