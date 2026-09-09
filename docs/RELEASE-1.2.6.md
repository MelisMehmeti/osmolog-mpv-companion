# Companion 1.2.6 release validation

- Full Companion regression suite: 84 passed.
- Browser redesign checks and native Electron checks passed for the redesigned source before the version bump.
- Dashboard Help notes updated; dashboard build and extension release validation passed.
- Windows installer and portable 1.2.6 built locally without publishing.
- All 38 packaged source/assets match the tested source and release checkout; package version and GitHub update provider verified.
- Installer SHA-512 matches latest.yml; local SHA-256 checksums generated for both executables.

The release tag workflow independently tests and builds the public Windows artifacts before uploading them. Its hashes may differ from the local build. Public asset checksums and updater metadata must be verified after publication.

Windows sign-out/sign-in and a real installed-app update were not exercised. No user's installed app, data, startup setting, or MPV configuration was changed by release validation.
