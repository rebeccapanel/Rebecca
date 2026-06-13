# Contributing to Rebecca

Thanks for considering a contribution to Rebecca.

## Questions

Please avoid opening issues for support questions. Use one of these channels instead:

- Telegram channel: [@rebeccapanel_rebecca](https://t.me/rebeccapanel_rebecca)
- GitHub Discussions for longer-term design or operational questions.

## Reporting Issues

When reporting a bug, include:

- What you expected to happen.
- What actually happened.
- Relevant server logs, browser console errors, or API responses.
- Rebecca version, install mode, database type, node version, and Xray version.
- Sanitized `.env`, node settings, and Xray config snippets when the issue depends on configuration.

## Branches

Use `dev` for normal development branches unless a maintainer asks you to target a feature branch such as `go-usage-bridge`.

Keep pull requests focused. Avoid mixing formatting, documentation moves, and behavior changes unless the cleanup is required for the feature.

## Project Layout

```text
.
|-- cmd/                 # Rebecca server and CLI entrypoints
|-- internal/            # Go gateway, Master API, migrations, node controller, proto schema, and domain packages
|-- dashboard/           # React dashboard. npm package files live here.
|-- templates/           # Built-in subscription and home templates used by Go
|-- docs/                # Project docs, translated READMEs, contributor docs
|-- scripts/             # Install/build/deployment scripts
```

## Architecture Notes

Rebecca's runtime is Go-owned.

- Go owns the gateway, Master API, migrations, node communication, admin/auth, users, subscriptions, services, settings, system, runtime helpers, and jobs.
- The gateway does not fall back to a Python backend.
- New backend behavior should be implemented in Go.

## Backend Development

Go backend:

```bash
go test ./...
```

Use database transactions for mutations that also enqueue node operations. If a DB write succeeds but the matching operation cannot be enqueued, the transaction should roll back.

## Dashboard Development

The dashboard is the only npm package in this repository. Run all npm commands from `dashboard/`.

```bash
cd dashboard
npm ci
npm run build
```

The root repository does not keep a `package.json` or `package-lock.json`. Dashboard dependencies and lockfiles belong in `dashboard/`.

## Documentation

The root `README.md` is the main project README. Other README files and contributor documentation live under `docs/`.

CLI documentation should be updated manually alongside Go CLI changes.

## Debug Mode

For dashboard development, run the Vite dev server from `dashboard/` and set `VITE_BASE_API` in `dashboard/.env` if the API address is not the default.

## Pull Request Checklist

- Keep the change scoped to one concern.
- Update docs when paths, commands, or runtime ownership changes.
- Run the relevant Go and dashboard checks.
- Do not commit generated build output unless the repository already tracks that exact artifact for a release flow.
- Do not include secrets, real server credentials, database dumps, or local test databases.
