# TODO: Go-Native Settings Follow-Ups

Settings routes are being moved to the Go Master API. The panel/subscription
settings, template content, and Rebecca backup flows are Go-native, but two
settings features are intentionally disabled until they can be rebuilt without
legacy Python/CLI coupling.

## Subscription Certificate Management

Current runtime behavior:

- `POST /api/settings/subscriptions/certificates/issue` returns `410 Gone`.
- `POST /api/settings/subscriptions/certificates/renew` returns `410 Gone`.
- Response detail:
  `Subscription certificate management is temporarily disabled and will be rebuilt with a new Go-native certificate flow.`

### Previous Python/CLI Flow

The old implementation lived in `SubscriptionCertificateService` and used the
on-host Rebecca CLI:

- Issue:
  - Validate domains with the panel domain regex.
  - Run:
    `rebecca ssl issue --email=<email> --domains=<comma-separated-domains> --non-interactive`
  - Read metadata from `/var/lib/rebecca/certificates/<primary-domain>/.metadata`.
  - Upsert a `subscription_domains` record:
    - `domain`
    - `admin_id`
    - `email`
    - `provider`
    - `alt_names`
    - `last_issued_at`
    - `last_renewed_at`
  - Return the certificate record with path
    `/var/lib/rebecca/certificates/<domain>/`.
- Renew:
  - Run `rebecca ssl renew`, optionally with `--domain=<domain>`.
  - If a single domain was requested, refresh metadata and upsert the same
    `subscription_domains` record.
  - If no domain was requested, return `null`.

### Why It Is Disabled

The old certificate flow still delegated the real ACME/certificate work to a
host-level CLI. Rebecca is moving toward Go as the main runtime, so adding this
back as a thin wrapper around legacy Python-era behavior would keep one of the
last settings features dependent on old host assumptions.

### Future Go-Native Certificate Flow

Recommended rebuild:

- Implement ACME issuance directly in Go, preferably with a maintained library
  such as `lego`.
- Support HTTP-01 and DNS-01 through explicit provider configuration.
- Store certificate metadata in `subscription_domains`.
- Store private material under `/var/lib/rebecca/certificates/<domain>/` with
  strict permissions.
- Support admin-specific subscription domains.
- Make issue/renew asynchronous with a persistent job table so browser/API
  clients can poll progress safely.
- Add explicit status/error fields instead of depending on CLI stdout/stderr.
- Add Telegram/report hooks only after Go Telegram handling is restored.

## 3x-ui Import

The 3x-ui importer is also disabled from Go with `410 Gone` and should be
rebuilt as a Go-native importer. The full design notes are in
[`TODO_GO_3XUI_IMPORT.md`](TODO_GO_3XUI_IMPORT.md).
