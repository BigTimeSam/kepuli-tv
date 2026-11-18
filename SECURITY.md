# Security policy

Kepuli-TV plays the viewer's own IPTV subscription. It holds that
account's credentials on the viewer's device and reads what a provider's
server sends: playlists, programme guides, pictures and streams. A fault
in how it does either is a security fault, and reports of one are welcome.

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. **GitHub's private reporting** (preferred): the repository's
   **Security** tab, **Report a vulnerability**. Only the maintainer sees
   it, and the fix can be prepared there.
2. Or by email to the address under **Contact** in the
   [privacy policy](https://bigtimesam.github.io/kepuli-tv/privacy/).

Say what you found, in which version and where (Chrome, Firefox, Edge,
Safari, the Android app, the iPhone and iPad app), and how to see it:
a playlist, an address or a few steps. The mock provider in `dev/mock/`
is the place to reproduce without a real account; please do not send a
real provider's address or credentials.

What to expect: an answer within a week, and an assessment within two.
A confirmed fault is fixed in the next release of every store it touches,
sooner when it lets a provider's data or another page reach the viewer's
credentials. You are credited in the release notes unless you would
rather not be. This is one person's project: there is no bounty.

## Supported versions

The latest release in each store, and `main`. Stores update installed
copies by themselves; an older version gets no fix of its own.

## What counts

- Credentials, addresses or viewing data leaving the device for anywhere
  but the viewer's own provider (the privacy policy says where data goes).
- A provider's data (a channel name, a programme's description, a
  playlist, a subtitle, a picture's address) running as code or markup in
  the player, or reaching another account's data.
- Code loaded or run from outside the package.
- In the apps: another app starting the player with an address of its
  choosing, or reading what the app stores.
- Anything in the build or the release that would let a changed package
  reach a store unnoticed.

Not a vulnerability here: a provider seeing its own subscriber's requests;
credentials stored unencrypted in the browser's extension storage, which
the privacy policy states; faults in a provider's server.

## How the project guards itself

For a reviewer, and for whoever works on it (`AGENTS.md` has the rules):

- **No build step and no npm dependencies** in what the browsers run: the
  files in the repository are the files shipped. Third-party code is three
  libraries in `vendor/`, each a whole upstream release pinned by its
  SHA-256 (`node dev/vendorcheck.mjs`).
- **Markup only from constants, nothing evaluated**: `node dev/htmlcheck.mjs`
  fails on `innerHTML` from data, `eval` and their kin, on every push.
- **No secrets in git**: `node dev/secretcheck.mjs` on every commit and in
  CI, with GitHub's secret scanning and push protection behind it.
- **Permissions are counted**: the manifests' against an approved list
  (`node dev/package.mjs --check`), the Android packages' merged manifests
  likewise (`node android/permissions.mjs`).
- **What is pinned is watched**: Dependabot for the GitHub Actions and the
  Android build; `node dev/freshcheck.mjs` and
  `node android/enginecheck.mjs` nightly for the vendored players, FFmpeg,
  the Cast SDK and the Android apps' browser engine, which fail once a
  newer release has been out for its grace.
- **The workflows** run with a read-only token, pin every action to a
  commit, need no secret, and are themselves analysed by CodeQL together
  with the JavaScript and the Java.
- **A release** is made by hand on the owner's word, from a commit whose
  full checks are green, and the package a store serves is read back and
  compared after approval (`node dev/cws-publish.mjs verify`).
