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

- Router work (ping, SNMP, NTP, UR35 config) never runs in the app server: queue an `agent_jobs` row and let the on-network helper (`public/helper/field-ops-helper.mjs`, via `/api/public/agent` + AGENT_TOKEN) execute it — routers are only reachable from the private network.
- Supported router jobs are defined in `src/lib/job-types.ts` and validated before queueing and dispatching so retired jobs cannot execute.
- Private Browser captures use a separate on-network Playwright service (`public/private-browser-service`) over authenticated HTTPS, not helper jobs; member-gated server functions relay only canonical RFC1918 IPs and ports 80/443/8443, with service-side CIDR and browser-request restrictions because private screenshots require network-local browser access.
- Access is role-gated: data RLS requires a `user_roles` row (`is_member`); the first signup becomes admin and admins grant others through Admin Settings; /users remains a guarded compatibility URL.
- Admin Settings routes gate on the parent role context, and every settings server function independently validates the caller's admin role through RLS before any privileged work; managed database credentials are never returned.
- Alternate-database connection profiles live in `public.database_connections` (admin-only RLS); passwords are AES-256-GCM encrypted in `src/lib/db-connection.server.ts` with the `DB_SECRET_KEY` secret and are never returned to clients. Connection tests use a real Postgres handshake (`postgres` package); the app's own data always stays on the managed Lovable Cloud connection.
- External PostgreSQL setup runs only through an independently admin-authorized server function, creates missing databases through the postgres maintenance database, and applies versioned transactional tables in an isolated field_ops schema with owner-only access; this preserves unrelated tables and never clones managed auth or performs an implicit cutover.
- Okta/OIDC credentials are configured in the Lovable Cloud backend auth settings (Users → Auth settings → OIDC), never stored in the app; Admin Settings only checks sign-in status, reachable Okta domains, and shows the callback redirect URI.
- Console Connect configuration uses two admin-only rows in public.console_connect_settings (Site ID lookup and SIM activation); passwords reuse encrypted credential storage and are never returned. Member-authorized operational functions load shared configuration through a server-only helper after is_member validation, because operational users must not read the credentials. Existing environment configuration remains the fallback until an admin saves a row; edited destinations are restricted to official provider HTTPS domains and redirects are rejected to prevent credential forwarding.
