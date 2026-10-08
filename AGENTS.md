# Production publication

- Publish the frontend through a push to `main` and the connected Vercel Git build.
- Never run `vercel deploy --prod`, publish `dist/`, or use `vercel --prebuilt` for production. Those paths can replace current code with stale local artifacts.
- A production promotion or rollback must use a Ready Git deployment whose full commit SHA is verified against the intended `main` commit.
- Run `npm run verify:production -- <full-commit-sha>` after publication. A successful upload or deployment status alone does not confirm the domain serves the intended code.
- Keep explicit safe columns in organization queries. Never restore browser SELECT privileges for organization credentials to work around a frontend query error.
- Preserve unrelated staged and untracked work when publishing a fix.
