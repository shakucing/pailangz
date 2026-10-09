<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environments and releases

- `main` is production at `https://pailangz.vercel.app`.
- `test` is the persistent test branch, intended for the separate Vercel project at `https://pailangz-test.vercel.app`. Work on `test` or feature branches based on it.
- The test app and database use the existing `preview` tier (`APP_ENV=preview`, `DATABASE_ENV=preview`), even though Vercel calls the separate project's stable deployment Production.
- Promote the tested commit to `main` with a fast-forward only merge when a production release is requested. Production keeps its own database records and evidence; never restore test data over production during promotion.
- Keep credentials and database snapshots under ignored local paths. Use `db:test:*` for the test copy; `.local/neon-transfer/` remains dedicated to production. Do not put imports, seeds, resets or owner credentials in Vercel's build/runtime.
- See `docs/test-environment.md` for resource setup, environment variables, migration handling and release commands.
