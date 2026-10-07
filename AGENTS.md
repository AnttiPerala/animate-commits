# Project workflow

- Automatically make a local Git commit after completing and verifying each major feature or fix. The user has authorized these commits; do not ask again.
- Review the diff and commit only relevant source, documentation, tests, and version metadata. Preserve unrelated user edits. Exclude binaries, captures, dependencies, logs, credentials, and local preferences. Do not push without a user request.
- Build the Windows EXE when delivering application changes. `npm run build:exe` automatically increments the patch version and writes to `dist/v<version>/`. Do not manually bump again for that build. Commit both package.json and package-lock.json with the feature.
- Run appropriate focused tests and verify the delivered version. Include the version and EXE link in the response.
- Failed build attempts reserve their version; gaps are allowed. Never reuse a version for a different build.
