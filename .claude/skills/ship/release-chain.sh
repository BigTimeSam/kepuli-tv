#!/bin/zsh
# The unattended part of a release, started by /ship once the release commit
# is pushed: waits for CI on it, runs the release check, makes the three
# packages, tags, publishes the GitHub release, then sends AMO and the Chrome
# Web Store their parts side by side. Each step is logged; a failing step
# stops its own branch and says so in the log.
#
#   release-chain.sh VERSION LOGDIR [--amo-shots] [--cws-shots] [--listing] [--perms "alarms notifications"]
#
#   --amo-shots   brand/firefox-screenshots/ changed: upload to AMO, then captions
#   --cws-shots   brand/screenshots/ changed: replace them in the Chrome dashboard
#   --listing     store/listings/ changed: fill the Chrome detailed descriptions
#   --perms "…"   the release adds these permissions: fill their justifications
#
# No hard timeouts on AMO steps: AMO's throttle can ask for hours, and a run
# cut short leaves screenshots half replaced (1.10.1).
VERSION=$1; LOGDIR=$2
[[ -n $VERSION && -d $LOGDIR ]] || { echo "usage: release-chain.sh VERSION LOGDIR [flags]"; exit 2; }
shift 2
AMO_SHOTS=0; CWS_SHOTS=0; LISTING=0; PERMS=""
while (( $# )); do
  case $1 in
    --amo-shots) AMO_SHOTS=1 ;;
    --cws-shots) CWS_SHOTS=1 ;;
    --listing) LISTING=1 ;;
    --perms) PERMS=$2; shift ;;
    *) echo "unknown flag $1"; exit 2 ;;
  esac
  shift
done
REPO=${0:A:h:h:h:h}
SKILL=${0:A:h}
LOG=$LOGDIR/release-$VERSION.log
cd $REPO || exit 1
SHA=$(git rev-parse HEAD)
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a $LOG; }
fail() { say "STOPPED: $*"; exit 1; }

[[ $(node -p "require('./manifest.json').version") == $VERSION ]] || fail "manifest.json is not $VERSION"
say "release $VERSION of $SHA begins"

# 1. CI: the newest push run and the newest full (workflow_dispatch) run of
# this commit, both green. A full run that went red on a flake and was run
# again counts by its newest run.
sleep 30
for i in $(seq 1 120); do
  pending=$(gh run list --branch main --workflow Checks --limit 15 --json headSha,status -q "[.[] | select(.headSha==\"$SHA\") | select(.status!=\"completed\")] | length")
  [[ $pending == 0 ]] && break
  sleep 60
done
[[ $pending == 0 ]] || fail "CI did not finish within two hours"
latest() { gh run list --branch main --workflow Checks --limit 15 --json headSha,event,conclusion -q "[.[] | select(.headSha==\"$SHA\") | select(.event==\"$1\")][0].conclusion"; }
[[ $(latest push) == success ]] || fail "the push run is $(latest push)"
if [[ $(latest workflow_dispatch) != success ]]; then
  id=$(gh run list --branch main --workflow Checks --limit 15 --json headSha,event,databaseId -q "[.[] | select(.headSha==\"$SHA\") | select(.event==\"workflow_dispatch\")][0].databaseId")
  fail "the full run ${id:-(none started)} is $(latest workflow_dispatch): $(gh run view $id --log-failed 2>&1 | grep -aoE 'FAIL  [a-zA-Z]+: .{0,100}' | head -3 | tr '\n' ' ')"
fi
say "CI green on $SHA"

# 2. The release check. AMO's screenshots being behind brand/ is expected
# when they go up below.
KEPULI_DEV_PORT=${KEPULI_DEV_PORT:-9374} node dev/release.mjs > $LOGDIR/release-check-$VERSION.log 2>&1
grep -E "^FAIL" $LOGDIR/release-check-$VERSION.log | tee -a $LOG
unexpected=$(grep -E "^FAIL" $LOGDIR/release-check-$VERSION.log | { (( AMO_SHOTS )) && grep -v "AMO" || cat; })
[[ -n $unexpected ]] && fail "release check: $unexpected"
say "release check passed"

# 3. Packages (older zips are shelved by package.mjs), tag, GitHub release.
node dev/package.mjs --zip >> $LOG 2>&1 || fail "package.mjs"
node firefox/amo-source.mjs >> $LOG 2>&1 || fail "amo-source.mjs"
for z in kepuli-tv-chrome-$VERSION.zip kepuli-tv-firefox-$VERSION.zip kepuli-tv-firefox-$VERSION-amo-source.zip; do
  [[ -f $z ]] || fail "$z is not there"
done
unzip -p kepuli-tv-chrome-$VERSION.zip manifest.json | grep -q gecko && fail "the Chrome zip carries gecko"
unzip -p kepuli-tv-firefox-$VERSION.zip manifest.json | grep -q gecko || fail "the Firefox zip has no gecko"
[[ -s dist/release-notes.md ]] || fail "dist/release-notes.md is missing"
git tag v$VERSION && git push -q origin v$VERSION || fail "tag v$VERSION"
gh release create v$VERSION kepuli-tv-chrome-$VERSION.zip kepuli-tv-firefox-$VERSION.zip kepuli-tv-firefox-$VERSION-amo-source.zip \
  --title "Kepuli-TV – IPTV Player $VERSION" --notes-file dist/release-notes.md >> $LOG 2>&1 || fail "gh release create"
say "GitHub release v$VERSION published"

# 4. The stores, side by side.
(
  AMOLOG=$LOGDIR/amo-$VERSION.log
  say "AMO: sending $VERSION"
  node dev/amo-publish.mjs > $AMOLOG 2>&1 && say "AMO: $VERSION, notes and listing sent" || say "AMO: amo-publish ended with an error, see $AMOLOG"
  if (( AMO_SHOTS )); then
    node dev/amo-screenshots.mjs >> $AMOLOG 2>&1 && say "AMO: screenshots replaced" || say "AMO: screenshots failed (resume with --old <ids>), see $AMOLOG"
    node dev/amo-publish.mjs captions >> $AMOLOG 2>&1 && say "AMO: captions sent" || say "AMO: captions failed, see $AMOLOG"
  fi
  say "AMO: $(node dev/amo-publish.mjs status 2>&1 | head -2 | tr '\n' ' ')"
) &
(
  CWSLOG=$LOGDIR/cws-$VERSION.log
  replace=""
  node dev/cws-publish.mjs status 2>&1 | grep -q PENDING_REVIEW && replace="--replace"
  say "Chrome: uploading $VERSION ${replace:+(cancelling the review in progress)}"
  timeout 1800 node dev/cws-publish.mjs upload $replace > $CWSLOG 2>&1 || { say "Chrome: upload failed, see $CWSLOG"; exit 1; }
  say "Chrome: $VERSION uploaded as the draft"
  sleep 20
  if [[ -n $PERMS ]]; then
    timeout 600 node $SKILL/cws-privacy-fill.mjs ${=PERMS} >> $CWSLOG 2>&1 && say "Chrome: justifications filled: $PERMS" || { say "Chrome: justifications failed, see $CWSLOG"; exit 1; }
  fi
  if (( LISTING )); then
    timeout 7200 node dev/cws-listing-fill.mjs >> $CWSLOG 2>&1 && say "Chrome: listing in step" || { say "Chrome: listing fill failed, see $CWSLOG"; exit 1; }
  fi
  if (( CWS_SHOTS )); then
    timeout 1800 node dev/cws-screenshots.mjs >> $CWSLOG 2>&1 && say "Chrome: screenshots replaced" || { say "Chrome: screenshots failed, see $CWSLOG"; exit 1; }
  fi
  timeout 1800 node dev/cws-publish.mjs submit >> $CWSLOG 2>&1 && say "Chrome: submitted for review" || say "Chrome: submit failed, see $CWSLOG"
  say "Chrome: $(node dev/cws-publish.mjs status 2>&1 | tail -2 | tr '\n' ' ')"
) &
wait
say "release run done"
