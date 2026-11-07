# Project independence audit

Reviewed 7 November 2026. Scope: application source, public media/helper archives, package manifest/lockfile, Vite/compiler/component configuration, migration configuration, documentation and deployment tooling. Repository history, dependencies' source/legal notices, secret values and private platform metadata were not rewritten. No database schema, records, operational rules or page designs were changed.

## Cleanup completed

### Application branding (including the preceding cleanup)

- Removed platform author/Twitter attribution from root metadata; organization attribution is Frontier Tower Associates Philippines.
- Removed the platform-specific error-reporting module and its root error-boundary hook; ordinary error logging and recovery remain.
- Replaced platform-named database/Okta text and server error messages with neutral application-backend descriptions.
- Removed the helper install-command fallback to a hosted platform domain; commands use the current website origin when requested.
- Removed promotional repository attribution and platform/editor links from README and deployment instructions.
- Visually inspected the favicon: it is the company's red/orange tower mark, not platform branding. Preserved the existing logo and tower background.

### Additional independence changes

| File | Change |
| --- | --- |
| `vite.standalone.config.ts` | Replaced platform wrapper import with direct standard Vite/TanStack/React/Tailwind/Nitro plugins; isolated environment, Node target, custom server entry, import protection and module deduplication retained |
| `deploy/auth-storage.ts` | Standard current-origin browser storage for standalone sign-in; no parent-frame broker or platform-host detection |
| `src/test/standalone-auth-storage.test.ts` | Tests origin-local persistence, readback and removal |
| `deploy/build.mjs` | Removed platform-specific build-preset environment handling; standard config determines target |
| `package.json`, `bun.lock` | Added independent development command and direct CSS compiler dependency |
| `bunfig.toml` | Removed unused package-age exemptions for four platform SDKs not installed or used by this app |
| `src/assets/fta-logo.png.asset.json` | Reduced pointer to neutral local URL; removed platform asset/project IDs and object-storage metadata |
| `public/media/fta-logo.png` | Moved identical existing logo bytes from the generated `/__l5e/assets-v1/...` path; no external image dependency |
| `deploy/check.mjs` | Included existing account-security and invitation-history tables in independent-backend readiness checks |
| `README.md`, `deploy/README.md` | Documented standard standalone tooling and local logo |
| `AGENTS.md`, `roadmap.md` | Recorded standalone boundary and verification status |

### Dependency disposition

- **No installed npm package was removed.** `lovable-tagger` and platform AI/email/MCP/webhook SDK packages were not installed; no usage was found.
- `@lovable.dev/vite-tanstack-config` remains a **development dependency for the default hosted configuration only**. The standalone configuration no longer imports it. Removing it from this connected project would break its required hosted configuration.
- Added `lightningcss` as a direct development dependency because standalone CSS compilation must not rely on the platform wrapper's transitive dependency.
- Standard React, TanStack, backend client, PostgreSQL, UI and helper dependencies are preserved. No package-lock file exists; Bun's lockfile is the dependency journal.

## Remaining references and why

| Location | Remaining footprint | Reason |
| --- | --- | --- |
| `vite.config.ts`, `package.json`, `bun.lock`, `bunfig.toml` | Platform configuration package and its installed-package exemption | Required by this project's default hosted preview/build; bypassed by standalone commands |
| `src/integrations/supabase/previewAuthStorage.ts` | Platform domains and preview authentication message names | Generated, security-sensitive preview integration; unmodified. Standalone config aliases its import to `deploy/auth-storage.ts` |
| Generated `client.ts`, `client.server.ts`, `auth-middleware.ts` | Platform name in missing-configuration errors | Generated files may not be edited here; core backend/auth integration is preserved. These are error strings, not required platform requests |
| `src/integrations/supabase/cron-auth.ts` | Platform-named scheduler secret variables | Generated scheduler support; no active imports found; not rewritten or disabled |
| `drizzle.config.ts` | `LOVABLE_DB_MIGRATION_URL` | Required hosted migration configuration; independent migration command uses `STANDALONE_DATABASE_URL` in `deploy/migrate.mjs` instead |
| `deploy/config.mjs` | Hosted domain suffix in destination-rejection guard | Deliberate safety check preventing accidental use of the hosted backend for a fresh independent install |
| `AGENTS.md`, `.lovable/*` | Protected editor guidance/planning metadata | Not served application content; preserved rather than deleting platform-managed instructions |
| Compiler caches/dependencies | Historical path strings and dependency/legal content | Generated artifacts are not production source; dependency/legal notices are not removed |

The platform-managed `.gitignore` could not be changed. On your own repository, ensure `.env`, `.env.*` (except safe examples), `*.tsbuildinfo`, dependencies and generated build output are excluded. Do not commit VM private environment files. Existing history cannot be purged through this cleanup.

## Runtime and deployment independence

- The **current hosted website still uses its existing managed backend**. This audit did not cut it over or change credentials, users, policies or data.
- Independent commands use an independently configured compatible PostgreSQL/auth/data-API backend. A plain PostgreSQL VM does not replace Auth and data APIs.
- The logo is local. The tower background is bundled. Google Fonts remains a third-party font source, not a platform dependency.
- Console Connect operations still use shared Site ID credentials and the existing API flow. Router/ping/screenshots still run through the separate on-network helper.
- Okta must be configured in your independent authentication service. SMTP handles Auth emails; automatic invitation-notification emails remain unimplemented as previously documented.
- No platform API key or AI gateway use was found in application code. Source may contain platform strings in generated error messages; this is not a claim of a completely string-free repository.

## Verification results

- **108 tests pass across 20 files**, including all existing application tests and the new standalone storage test.
- **Hosted preview build reports build OK.**
- The standalone configuration was loaded in production/build mode through Vite's configuration loader: standard plugins and isolated environment directory were confirmed; it does not import the hosted wrapper.
- Package/lockfile update completed. Remaining platform package usage is isolated to the default hosted config.
- Leaf content routes have app-specific metadata. Compatibility redirect routes carry no content.
- Browser checks verify company logo rendering on public and authenticated pages, Admin Settings access and password generation/show-hide/copy without submitting an invitation or activating a SIM.
- **Full standalone production build was not executed here.** Run `bun run build:standalone` on the target Ubuntu VM; then run `check:standalone` and the live acceptance checks. Configuration loading and mocked migration tests are not production-build or live-backend verification.
- Fresh independent Auth, SMTP, Okta, VM reboot/restore, private-network connectivity and real SIM/router actions still require the target VM and authorized integration access. No claim of a fully verified cutover is made.

## Outcome

Actual cleanup is complete for editable branding, standalone build-tool coupling, preview-broker coupling in standalone builds and local logo asset metadata. Required hosted/generated references remain explicitly listed. Independent deployment is prepared but remains subject to the VM build and live acceptance checks, not certified production-ready by this audit alone.