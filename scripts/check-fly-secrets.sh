#!/usr/bin/env bash
# Reconcile machine_config.json's declared secrets against the names that
# actually exist in `fly secrets`, and fail before deploying when they disagree.
#
# **Why this is a check and not a convention.** Under `[experimental]
# machine_config`, a Fly secret reaches a container only if that container names
# it. Adding a secret is therefore two edits in two systems - `fly secrets set`
# and this repository - and every time the two have drifted apart it has cost
# real production behaviour:
#
#   declared, not set    machine_config.json said SENDGRID_API_KEY while the
#                        secret was set as SENGRID_API_KEY. flyd could not apply
#                        the config, reverted every deploy for a day, and flyctl
#                        reported success throughout. Authenticated requests
#                        401'd for that whole day.
#
#   set, not declared    AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET were
#                        set the day #59 shipped and declared by nobody, so
#                        account deletion silently skipped the Auth0 identity -
#                        the exact bug #59 existed to fix. Before that, the same
#                        thing happened to INVITE_EMAIL_PEPPER and HashEmail
#                        quietly degraded to a plain SHA-256.
#
# fly.toml's comment block has documented this trap since the first instance.
# Four instances later, documenting it is demonstrably not enough.
#
# **Both directions are errors, and the second one deliberately so.** A secret
# declared nowhere cannot break a request, so the temptation is to warn. But the
# whole lesson of the deploy incident is that nothing reads a warning in a green
# run - a set-but-undeclared secret has now twice meant a security property
# silently not holding, and neither was noticed by anyone. A secret that is
# genuinely meant to exist without reaching any container goes in
# `undeclared_on_purpose` below, which makes it a reviewed decision instead of a
# line of log output.
#
# Read-only: it lists secret NAMES and nothing else. `flyctl secrets list` never
# emits a value, only a digest, so there is no value here to leak.
set -euo pipefail
cd "$(dirname "$0")/../api"

# Secrets that exist on the app on purpose while reaching no container. Empty,
# and it should stay that way - add a name only with a comment saying why, and
# prefer `fly secrets unset` if the real answer is that nothing needs it.
undeclared_on_purpose=()

declared=$(jq -r '.containers[].secrets[]?.env_var' machine_config.json | sort -u)

# Across *every* container, not just `api`. Scoping this to one container would
# report the collector's GRAFANA_CLOUD_* trio as undeclared on every run.
if ! actual=$(flyctl secrets list --config fly.toml --json | jq -r '.[].name' | sort -u); then
  echo "::error::could not list secrets. This check cannot be skipped on a"
  echo "::error::failure to read - that is how it would come to pass silently."
  exit 1
fi

if [ -n "${undeclared_on_purpose[*]:-}" ]; then
  actual=$(comm -23 <(echo "$actual") <(printf '%s\n' "${undeclared_on_purpose[@]}" | sort -u))
fi

missing=$(comm -23 <(echo "$declared") <(echo "$actual"))   # declared, not set
orphaned=$(comm -13 <(echo "$declared") <(echo "$actual"))  # set, not declared

status=0

if [ -n "$missing" ]; then
  status=1
  echo "::error::machine_config.json declares secrets that do not exist:"
  echo "$missing" | sed 's/^/::error::  /'
  echo "::error::flyd cannot apply a config naming a secret it cannot resolve."
  echo "::error::It will revert the machine and flyctl will report success"
  echo "::error::anyway, leaving production on the previous image and [env]."
  echo "::error::Check for a typo first - that is what it was last time."
fi

if [ -n "$orphaned" ]; then
  status=1
  echo "::error::secrets exist on the app but are declared by no container:"
  echo "$orphaned" | sed 's/^/::error::  /'
  echo "::error::Each will be an empty string at runtime, with nothing"
  echo "::error::reporting a problem. If the API reads one, the feature behind"
  echo "::error::it is silently degraded. Declare it in the right container's"
  echo "::error::'secrets' array, 'fly secrets unset' it, or - if it really is"
  echo "::error::meant to sit unused - add it to undeclared_on_purpose in this"
  echo "::error::script, with a reason."
fi

if [ "$status" -eq 0 ]; then
  echo "OK: $(echo "$declared" | wc -l | tr -d ' ') declared secrets match the app's."
fi

exit "$status"
