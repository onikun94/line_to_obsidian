# Obsidian scorecard checks

The community scorecard scans the latest published release, not open pull requests.
After merging these changes, a new plugin release and an Obsidian rescan are needed
before the public Review rating can change. A local lint pass does not confirm a
particular public rating.

The plugin requires Obsidian 1.4.0 because it uses `Vault.createFolder`. Its settings
use shared searchable definitions on 1.13.0+ and an imperative renderer on older
versions. New runtime API calls are gated with `requireApiVersion`.

`pnpm lint` checks the scorecard's TypeScript and Obsidian API rules. The Worker
uses Cloudflare's `fetch`, which cannot be replaced by Obsidian's `requestUrl`.
Those five server calls carry narrowly scoped, explained ESLint exceptions so
repository-wide scans do not mistake them for plugin network requests.

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
