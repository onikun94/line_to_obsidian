# Obsidian scorecard checks

The community scorecard scans the latest published release, not open pull requests.
After merging these changes, a new plugin release and an Obsidian rescan are needed
before the public Review rating can change. A local lint pass does not confirm a
particular public rating.

The plugin requires Obsidian 1.4.0 because it uses `Vault.createFolder`. Its settings
use shared searchable definitions on 1.13.0+ and an imperative renderer on older
versions. New runtime API calls are gated with `requireApiVersion`.

`pnpm lint` checks the scorecard's TypeScript and Obsidian API rules, including
the official preset's restrictions on ESLint disable comments. Never disable
`no-restricted-globals` inline: the community scanner rejects that suppression.
The local `fetch` restriction applies to the Obsidian plugin, which uses
`requestUrl`. The separate Cloudflare Worker uses its standard `fetch` API.
Repository-wide community scans may report those five server calls as advisory
warnings; do not suppress them or replace them with Obsidian APIs.

`pnpm lint:review` applies the complete official preset with the documented
community scanner severity levels and exclusions. Security rules and restrictions
on suppression comments remain errors. CI runs this check for both packages.

Follow the [plugin guidelines](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md) and
[official scanner configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md).
Before publishing, run **Review branch** in the Obsidian community developer
dashboard and check that it passes. After publishing, use **Check for new releases**
and verify the review of the exact new version; GitHub CI and artifact attestations
alone do not establish that the community review passed.

`pnpm build` produces `main.js` and `styles.css` at the repository root beside
`manifest.json`, where build verification expects them. The release workflow uses
the frozen lockfile, public default API URL, and the same files for attestation
and publication. `OBSIDIAN_LINE_API_URL` and `PAYMENT_PAGE_URL` remain available for
development overrides; official releases use the defaults.

Hono is updated to 4.13.13. Check production dependencies with `pnpm audit --prod`.
Development-tool advisories are separate from the plugin bundle and Worker runtime.

Unavailable malware and dependency scan disclosures describe checks on Obsidian's
side. The root build layout addresses the missing `main.js` warning; whether build
verification becomes available and succeeds must be checked after a release rescan.
