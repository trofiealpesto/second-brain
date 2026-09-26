# Optional Second Brain Siri companion

A native macOS app using App Intents, SwiftData, Spotlight, and on-device
Foundation Models. It calls the Worker's `/v1/siri/*` API with OAuth/PKCE rather
than acting as an MCP client. The base cloud setup does not require it.

## Build for your own server

Requires **Xcode 27 / Swift 6.4 and macOS 27+**, with an Apple Silicon target.
Select the toolchain per command; do not change your system-wide Xcode selection
just to build this project. From this directory:

```sh
DEVELOPER_DIR='/Applications/Xcode 27 RC.app/Contents/Developer' swift test -j 2
DEVELOPER_DIR='/Applications/Xcode 27 RC.app/Contents/Developer' xcodebuild \
  -project SecondBrainSiri.xcodeproj -scheme SecondBrainSiri \
  -configuration Debug -derivedDataPath .build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  SECOND_BRAIN_SERVER_URL=https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev build
```

Adjust the Xcode path to your installation. The server URL is an **HTTPS origin**,
without `/mcp`, credentials, query, or fragment. The unconfigured default is a
non-routable `.invalid` origin and sign-in explains which setting is missing.
For a Swift package test run there is intentionally no configured live server.

The bundled replica uses `org.example.secondbrain.replica` and callback
`secondbrain-replica://oauth/callback`. Set your own unique bundle ID for a
distributed build. Keychain/cache/Spotlight names incorporate the bundle and server,
so the replica does not reuse the original app's local state or credentials.

No signing/notarization/release workflow or Apple credentials were imported.
Building does not install, launch, sign in, or sync the app.

## Behavior and privacy

- The app's GitHub OAuth identity must be in the Worker's login allowlist.
- Reads use `brain.read`; writes use `brain.write`. The automation token is not accepted.
- Voice-style captures create immutable `raw/voice/` pages.
- Page edits/moves/archive use revision checks; archive is reversible.
- Initial local copying and Spotlight indexing require user consent.
- Answer synthesis uses the on-device model when available; otherwise it returns
  excerpts and sources. There is no cloud-model fallback.
- Siri search avoids storing the question in Worker retrieval metrics.
- Disconnect removes this replica's own credentials and local data. Independent
  Git history, backups, and server-side data are separate.

Full GUI/OAuth/Siri acceptance requires a deliberately configured test instance
and interactive login. Unit tests and unsigned builds do not establish that flow.
There is no iOS target in this module.
