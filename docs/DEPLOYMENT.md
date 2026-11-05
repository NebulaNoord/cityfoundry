# Deploying CityFoundry

CityFoundry is hosted on **Vercel** (free Hobby plan) and is public.

- Vercel project: `cityfoundry` (team "NebulaNoord's projects")
- Linked repo: `NebulaNoord/cityfoundry`
- **Production branch: `main`.** Every push to `main` builds and deploys the public game automatically.
- Every push to any other branch gets a private preview deployment (only the owner can open it).

Vercel detects Vite automatically: build command `npm run build`, output `dist/`. No `vercel.json` needed.

## Rules for Big Dawg and Picasso
1. Push to `main` only when `npm test`, `npm run test:e2e` and `npm run build` all pass. A push to `main` is a public release.
2. Use feature branches for work in progress; their preview URLs are for checking a build before merging.
3. After pushing to `main`, check the production deployment reaches **READY** and the game loads at the public URL with no console errors. If a release is broken, roll back to the previous production deployment, then fix forward.
4. Nothing that costs money: no paid plan upgrades, domains, add-ons or usage-billed features.
5. Never commit API keys or secrets. CityFoundry needs no environment variables.
