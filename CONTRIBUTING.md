# Contributing

Thanks for helping improve NextDNS Detailed Analytics.

## Before you start

- Keep version 1 focused on configuring the analytics request limit.
- Do not add credentials, account linking, a separate analytics API client, telemetry, remote code, or unrelated site permissions.
- Keep request matching restricted to the NextDNS analytics endpoint.
- Treat the reference extension as behavioral context; do not copy its implementation.

## Changes

1. Make the smallest clear change that addresses the issue.
2. Add or update Node tests for behavior changes.
3. Run `node --test` and report the result in your change description.
4. Update the README when permissions, network behavior, or setup steps change.

Use descriptive commits and include manual browser verification details for any changes to actual request modification behavior.
