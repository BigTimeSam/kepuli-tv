---
name: ship
description: Release Kepuli-TV end to end on the owner's go — commit and push everything, bump the version, release notes, screenshots and store texts when they changed, the GitHub release, AMO and the Chrome Web Store. Only when the owner types /ship.
argument-hint: "[patch|minor|X.Y.Z]"
disable-model-invocation: true
---

# /ship: release the current work

The owner typing `/ship` **is** the explicit go of AGENTS.md rule 2 for
this one release, in this conversation: commit, push, tag, GitHub release,
upload to both stores and submit for review. It does not carry over to a
later release or another conversation. Everything else in AGENTS.md still
holds (no secrets, the owner's browsers and ports left alone, the owner
edits the same checkout). Talk to the owner in Finnish; everything written
into the repo, the notes and the stores is British English.

Argument: `patch`, `minor` or an exact `X.Y.Z`. Without one, choose from the
commits since the last tag: only fixes → patch, anything new a user can do →
minor; say which and why in the first report.

Keep a scratch directory (`$S` below, the session's scratchpad) for logs,
profiles and screenshots. Use your own ports (Chrome 9371–9378, Firefox
2871) after `lsof -nP -iTCP:<port> -sTCP:LISTEN`; never 9222, 2828, or a
port another session holds.

## 1. Take stock

- `git status`, `git log --oneline $(git describe --tags --abbrev=0)..`,
  `git fetch` and whether main is behind origin.
- **All changes ship.** Uncommitted work — the owner's too — goes in, in
  logical commits (AGENTS.md "Commits"). List what you found in the first
  report. Ask only if something looks unfinished or broken (fails a check,
  half a feature, a debug leftover).
- `node dev/cws-publish.mjs status` (a version still in review? the chain
  replaces it, which uses the small daily cancel quota) and
  `node dev/amo-publish.mjs status`.
- The Chrome dashboard sign-in: `node dev/cws-listing-fill.mjs --signed-in`
  (opens the dashboard Chrome if it is closed). If Google wants the owner to sign in again, ask now (AskUserQuestion) —
  not halfway through the chain.

## 2. Commit the pending work

For each logical change: the checks of AGENTS.md "Commits"
(`unitcheck`, `namecheck`, `typecheck`, `htmlcheck`, `docscheck`,
`secretcheck` on the staged changes; `site.mjs --check` / `listings.mjs
--check` when README or listings changed), a sentence subject, a body
saying why, and the attribution trailer. A user-visible change needs its
line in `docs/user-guide.md`; a new string all 30 languages
(`node dev/translations.mjs --check`).

## 3. Screenshots and store texts, if they changed

- `node dev/visualcheck.mjs` (own port). A difference that is not intended
  is a bug: stop and fix it. An intended one: `--update`, then **keep only
  the views that really changed** (`git checkout -- dev/visual/<others>`:
  `--update` rewrites every reference).
- If the five store views changed, retake the store screenshots
  (docs/agents-recipes.md "Retake the store screenshots"): into `$S` first,
  look at all ten, then into `brand/`, `node dev/site.mjs`, captions in
  `brand/firefox-screenshots/README.md` if they change. Commit PNGs,
  references and `docs/` together. Note `--amo-shots` and `--cws-shots`
  for the chain.
- `store/listings/` changed: `node dev/listings.mjs` (writes `_locales/`),
  `--check` passes; note `--listing` for the chain.
- A new permission: its justification section in
  `store/chrome-dashboard.txt` (`<PERM> JUSTIFICATION`, ≤ 1000 characters),
  the reviewer notes, maybe the privacy policy; note `--perms "<perm> …"`.

## 4. Version and notes

- Bump `version` in `manifest.json` and `firefox/manifest.json`;
  `node dev/package.mjs --check`.
- `firefox/reviewer-notes.txt`: the version line; at most 3000 characters
  with line breaks counted twice (`release.mjs` checks it).
- `node dev/releasenotes.mjs > dist/release-notes.md`, then rewrite it in
  the style of the previous release (`gh release view v<last>`): sections
  by where a user meets the change, bold UI names, plain sentences, no
  development section.

## 5. Test locally

`node dev/unitcheck.mjs`, the full `node dev/playcheck.mjs` with your own
port and profile (`KEPULI_DEV_PORT=937x`), the touched scenarios in Firefox
(`KEPULI_BROWSER=firefox KEPULI_FIREFOX_PORT=2871`), `node dev/uicheck.mjs`,
`node dev/visualcheck.mjs`. Run them in the background with a log. A single
flaky scenario passes alone before you call it a flake; a real failure is
fixed and committed before going on.

## 6. Release commit and CI

- `git status` once more, `node dev/secretcheck.mjs`, commit
  `Release X.Y.Z: <summary>`, `git push`.
- `gh workflow run Checks --ref main` for the full run besides the push
  run. If the full run goes red, read the failure
  (`gh run view <id> --log-failed`): a harness flake on CI timing is fixed
  in the harness and committed (a new commit means new CI runs), not
  ignored; rerun only a proven one-off (`gh run rerun <id> --failed`).

## 7. The unattended chain

Start it in the background (Bash `run_in_background`), no outer timeout:

```
.claude/skills/ship/release-chain.sh X.Y.Z $S [--amo-shots] [--cws-shots] [--listing] [--perms "a b"]
```

It waits for both CI runs, runs `dev/release.mjs`, makes the three zips,
tags, publishes the GitHub release, then sends AMO (version, listing,
screenshots, captions) and Chrome (upload, justifications, listing,
screenshots, submit) in parallel. Logs: `$S/release-X.Y.Z.log` (summary),
`amo-X.Y.Z.log`, `cws-X.Y.Z.log`, `release-check-X.Y.Z.log`.

Wait for it with a waiter on its PID, never on `pgrep` of a pattern
(the waiter's own command line matches it and waits for ever):
`while kill -0 <pid> 2>/dev/null; do sleep 300; done; tail -6 $S/release-X.Y.Z.log`.
Report to the owner when the GitHub release is out, then again when the
chain ends. A STOPPED line: fix the cause, then carry on by hand from that
step; do not restart the chain from the top once the tag exists.

Known behaviour:
- AMO throttles writes for minutes to hours; the tools wait it out. A
  screenshot run cut off is resumed with `amo-screenshots.mjs --old <ids of
  the old previews>` (`--dry` lists them). Only one AMO writer at a time.
- The Chrome listing is locked while a version is in review, which is why
  the chain uploads first (cancelling a pending review) and fills after.
- The dashboard Chrome (port 9444, `~/.config/kepuli-tv/cws-chrome`) may
  ask for sign-in mid-run: ask the owner, then repeat the failed step.

## 8. After the stores

- `node dev/amo-publish.mjs status`: AMO usually makes the version public
  within minutes.
- Chrome review takes hours to days. Once approved,
  `node dev/cws-publish.mjs verify` must report the new version,
  `service_worker` and no `gecko` (the Firefox zip went to Chrome twice).
  Before the approval it reports the old version; that is expected.
- Files the chain changed (`store/amo-screenshots.json`,
  `store/cws-listing.json`) are committed and pushed as a follow-up.
- Final report in Finnish: what was released, each store's state as it
  is, and what is still waiting on whom.
