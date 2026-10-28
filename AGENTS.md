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
- Access is role-gated: data RLS requires a `user_roles` row (`is_member`); the first signup becomes admin and admins grant others on /users.
