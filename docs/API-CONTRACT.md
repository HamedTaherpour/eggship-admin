# OpenAPI contract workflow

`contracts/eggship-backend.openapi.json` is the only API contract source for EggShip Admin. The checked-in file must be the exact JSON artifact generated and approved by the independent NestJS backend; do not hand-edit it or create frontend DTOs separately.

## Generate and check types

The repository pins `openapi-typescript` exactly. Generated types live in `src/generated/api-types.ts` and are not handwritten.

```bash
pnpm api:generate
pnpm api:check
```

`api:generate` validates the snapshot, reports its OpenAPI version and operation coverage, and rewrites the generated file. `api:check` performs the same validation and compares generated output in memory, so it detects drift without modifying files.

## Updating the backend snapshot

1. Ask the backend team for the approved OpenAPI JSON export and its backend commit or release identifier.
2. Replace `contracts/eggship-backend.openapi.json` with that exact artifact; do not merge in local endpoint or DTO changes.
3. Run `pnpm api:generate`, review the generated diff, and record the backend source revision in the change description.
4. Run `pnpm api:check` and the repository verification commands before review.

The frontend does not implement authentication, transport, proxying, or business pages as part of contract generation.
