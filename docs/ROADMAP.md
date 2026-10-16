# Roadmap

## Bootstrap complete

- Establish EggShip identity, Persian document metadata, and RTL direction.
- Migrate package management to pnpm.
- Remove credential exposure from demo authentication forms.
- Document the frontend/backend boundary and integration risks.

## Next

1. Obtain the backend-generated OpenAPI JSON and record its source revision.
2. Review and approve the integration ADR in `docs/architecture/ADR-001-api-integration.md` with the backend and deployment teams.
3. Add pinned OpenAPI type generation and contract validation; do not add handwritten backend DTOs.
4. Verify the same-origin reverse proxy, host-only cookie, CSRF, request ID, and error behavior in a non-production environment.
5. Implement the smallest authenticated read-only slice using the approved contract.
6. Replace demo datasets incrementally, with loading, empty, error, and permission states.
7. Audit component-level RTL behavior and add visual regression coverage for desktop, mobile, and dark theme.
