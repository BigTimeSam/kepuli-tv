@AGENTS.md

## Notes for Claude Code

- The project's rules are in `AGENTS.md` above and in the `AGENTS.md` of each
  directory; every directory with one also has a `CLAUDE.md` that imports it,
  so it loads when you work there.
- Browser automation extensions (claude-in-chrome) cannot script the Chrome
  Web Store dashboard or addons.mozilla.org pages; use the store tools in
  `dev/` (they drive their own Chrome over DevTools, or the APIs).
- Long store operations (AMO throttling, Chrome reviews) belong in background
  shell tasks with a log file; chain dependent steps instead of polling.
- Use a scratch directory for profiles, logs and screenshots, never the repo
  or the owner's `~/.cache/kepuli-tv-*` profiles.
