#!/usr/bin/env bash
# Assert that the Fly machines are actually running the release that was just
# deployed, and fail the run when they are not.
#
# **Why this exists: a green `flyctl deploy` is not evidence of a deploy.**
# Between 2026-08-20 and 2026-08-21 every run of .github/workflows/deploy-api.yml
# reported success while the machines kept a day-old image and a day-old `[env]`.
# The mechanism is that flyctl and flyd are two processes: flyctl creates a
# release and asks flyd to apply it, flyd fails to apply it and *reverts* the
# machine to the last config that started cleanly, and flyctl then sees a
# started, healthy machine and exits 0. The revert appears only in the machine's
# own event log:
#
#   started   | revert | flyd | 2026-08-21T20:38:30.383+01:00
#   replacing | update | user | 2026-08-21T20:38:27.65+01:00
#
# The cause that time was a secret declared in machine_config.json under a name
# that did not exist in `fly secrets` (SENDGRID_API_KEY vs the SENGRID_API_KEY
# that was actually set). Any config flyd cannot apply does the same thing, so
# this checks the outcome rather than that one cause.
#
# **Nothing on the release record can substitute for this.** All 25 releases in
# the app's history - the eleven reverted ones included - report
# `Status: complete`, `InProgress: false` and `Stable: false`. Those fields are
# vestiges of Apps V1, where a deploy was a Nomad rollout with a state machine;
# on Apps V2 nothing fills them in, so they are constants rather than signals.
# `Stable` is false on releases that demonstrably took. The machines are the
# only thing worth asking.
#
# Read-only: it lists releases and machines and writes nothing.
set -euo pipefail
cd "$(dirname "$0")/../netlify-functions/recipes"

# `-c fly.toml` from this directory, rather than `-a big-shop-api`, so the app
# name lives in exactly one place - the same file the deploy step passes.
fly_args=(--config fly.toml --json)

# The release flyctl just created. Read purely as "the number and image to
# expect on the machines" - see above for why its own status means nothing.
# Safe to take the newest without a race: the workflow's `concurrency` group
# serialises deploys, so no second one can have released while this ran.
release=$(flyctl releases "${fly_args[@]}")
want_version=$(jq -r '.[0].Version'  <<<"$release")
want_image=$(jq -r   '.[0].ImageRef' <<<"$release")

if [ -z "$want_version" ] || [ "$want_version" = null ]; then
  echo "::error::could not read the current release from flyctl"
  exit 1
fi
echo "Expecting release $want_version on $want_image"

# Polled rather than asked once. `flyctl deploy` has already waited for the
# machines to become healthy, so this is covering read-after-write lag in Fly's
# API and nothing else - hence a short bound. It is deliberately not a
# retry-until-green: a machine that has not converged within a minute of a
# finished deploy is the failure this script is for.
attempts=6
for attempt in $(seq 1 "$attempts"); do
  bad=0
  seen=0

  # Fields, in order: machine id, its state, its process group, the release its
  # config claims, and the image that config runs.
  #
  # `fly_release_version` is checked as well as the image because a release does
  # not have to change the image to be a release - `fly secrets set` makes one,
  # and so does a redeploy of unchanged source. Several consecutive releases in
  # this app's history share one ImageRef. Against those, an image comparison
  # passes whether or not the config applied, because the machine was already
  # running that image. The release version always moves.
  while IFS=$'\t' read -r id state group version image; do
    [ "$group" = app ] || continue
    seen=$((seen + 1))

    [ "$state" = started ] ||
      { echo "  machine $id: state is $state, want started"; bad=1; }
    [ "$version" = "$want_version" ] ||
      { echo "  machine $id: on release ${version:-none}, want $want_version"; bad=1; }
    [ "$image" = "$want_image" ] ||
      { echo "  machine $id: running ${image:-none}, want $want_image"; bad=1; }
  done < <(flyctl machines list "${fly_args[@]}" | jq -r '.[] |
    [ .id,
      .state,
      (.config.metadata.fly_process_group   // ""),
      (.config.metadata.fly_release_version // ""),
      (.config.image                        // "") ] | @tsv')

  # A filter that matches nothing is how an assertion quietly stops asserting.
  # There is always at least one machine in the `app` group; none means the
  # process group was renamed, or the query returned something unexpected, and
  # either way this script no longer knows what it is checking.
  if [ "$seen" -eq 0 ]; then
    echo "::error::no machines found in process group 'app' - this check is not"
    echo "::error::verifying anything. Compare fly.toml's process groups with"
    echo "::error::'flyctl machines list --config fly.toml'."
    exit 1
  fi

  if [ "$bad" -eq 0 ]; then
    echo "OK: all $seen machines are running release $want_version."
    exit 0
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    echo "  (attempt $attempt of $attempts; re-checking in 10s)"
    sleep 10
  fi
done

echo "::error::The machines did not take release $want_version, though flyctl"
echo "::error::reported a successful deploy. The most likely cause is that flyd"
echo "::error::could not apply the new config and reverted it - check for a"
echo "::error::'revert' event in 'flyctl machine status <id>'."
echo "::error::"
echo "::error::The usual reason is a secret named in machine_config.json that"
echo "::error::does not exist in 'flyctl secrets list', including by typo. Note"
echo "::error::the app is still serving the OLD image and the OLD fly.toml"
echo "::error::[env] - nothing from this deploy has reached production."
exit 1
