# dev/mock/: the invented IPTV provider

`server.mjs` is a fake Xtream Codes server with a whole invented catalogue:
countries and topics, channels with programme data and catch-up archive,
films, series with MKV episodes and subtitles, the same catalogue as an M3U
playlist with an XMLTV guide, and a Stalker portal. Every test, screenshot
and demo video runs against it, so no real account is ever needed and
nothing real appears in the repository or the store pictures.

```
sh dev/mock/media.sh          # once: renders the dummy media with ffmpeg into media/ (git-ignored)
node dev/mock/server.mjs      # http://127.0.0.1:8790, user demo, password demo
```

Tools usually start it themselves through `startMockServer(port)`; the
accounts scenarios start a second one on 8791. `KEPULI_MOCK_PORT` and
`KEPULI_MOCK_HOST` move it; `Dockerfile` and `fly.toml` deploy the same server
as the hosted demo for store reviewers.

## Rules

- **Everything is fiction.** Names, plots, people and channels are invented
  ("Aurora One", "Northern Lights"); keep it so. No real channel names, brands
  or provider addresses, ever.
- **Deterministic.** Everything derives from fixed seeds and a clock frozen at
  start-up (`T0`; `KEPULI_MOCK_NOW` sets it, as the visual check does), so a
  screenshot or a test repeats exactly. New content uses
  the same seeded `rng`, not `Math.random()`.
- **Misbehaviour is opt-in, per request.** Each fault a scenario needs is a
  `KEPULI_MOCK_*` environment variable read when the request arrives, so a
  scenario sets it, runs and clears it. The current set: `BAD_GATEWAY`,
  `LIVE_BAD_GATEWAY`, `CHANNEL_REFUSED`, `REFUSED_FILE`, `NO_ANSWER`,
  `FAIL_LISTS`, `SLOW_LIST`, `HANG_AT`, `CUT_AT`, `HOLE`, `THROTTLE`,
  `RELEASE_MS`, `LIMIT` (connections per account), `LIVE_TS` (live as one
  MPEG-TS connection, as a provider's; recording needs it), `TS_PACE`,
  `TS_AS_MP`, `LONG`, `FULL`, `EMPTY`, `EPISODE_EXT`, `EXTRA_CHANNEL`,
  `STALKER_LOOSE`, `VERSIONS` (the first film in three copies and two later parts, an original title and a sound language), `EPISODE_NAMES` (episodes named "Series – S01E01" as providers do), `BULK` (N invented films more in Movies: Nordic, for the
  perf scenario). Read the code for each one's exact meaning, and document a
  new one in the comment beside it.
- **Exports for tests**: `startMockServer`, `PORT`, `USER`, `PASS`,
  `STALKER_MAC`, `MULTI_EPISODES`, `connectionStats`, `stalkerSeen`. Tests
  assert on `connectionStats()` (open and refused connections) rather than
  guessing.
- Catalogue facts that tests and the demo rely on: film names carry their year
  ("Planet Arctic (2019)"); the last title of each film genre is an AVI (shown
  as unplayable), the first two are MP4; Silent Fjord's episodes are MKV with
  English and Finnish subtitles; every film's picture is the same demo clip.
  Changing these breaks scenarios and the store screenshots: run them.
