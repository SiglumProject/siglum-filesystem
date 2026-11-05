# Contributor Guide

This repository publishes the MIT-licensed `@siglum/filesystem` package. It is a
TypeScript browser storage library with OPFS and IndexedDB backends.

## Working in the Repository

- Read `package.json` for the public export map and available commands.
- Change files in `src/`. `bun run build` generates `dist/` and declarations.
- Keep runtime IndexedDB imports on the `@siglum/filesystem/IndexedDBBackend`
  subpath. The root exports its type and loads the backend lazily.
- Use `src/constants.ts` for shared storage identifiers and `src/types.ts` for
  the backend contract. See `docs/development.md` for the full repository map.
- Follow the existing TypeScript style, with explicit types where useful,
  single quotes, and no semicolons. The build uses strict TypeScript checks.

## Storage Changes

Preserve existing document locations, namespace isolation, and saved backend
preferences. Review backend selection in `src/FileSystemService.ts` before
changing storage initialization. Distinguish missing files from browser access
or read failures, and keep data intact when an operation fails partway.

Exercise storage changes with the relevant regressions in `tests/`, including
`backend-selection.test.ts`, `OPFSBackend.test.ts`, and
`storage-safety.test.ts`. `tests/setup.ts` provides fake IndexedDB for Bun.
Browser API behavior also needs browser verification when mocks cannot cover it.
Use synthetic documents for checks that write storage.

## Commands and Documentation

```bash
bun install
bun run build
bun test
```

Run the build and tests for source changes. A focused run can use
`bun test tests/backend-selection.test.ts`. `bun run dev` watches TypeScript.
Update the README quick start and `docs/usage.md` when the public API changes. Verify imports against
the export map.
Keep publication procedures in private maintainer notes.

Keep evergreen README and contributor instructions free of fixed current package
versions and release dates. Use unversioned install commands and link to package
metadata, registry badges, or release notes for current versions. Keep schema
versions and numeric API examples when they explain actual behavior.
