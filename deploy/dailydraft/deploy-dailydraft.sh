#!/usr/bin/env bash
set -euo pipefail

readonly artifact_bucket="dailydraft-production-deploy-948918267147-us-west-1"
readonly aws_region="us-west-1"
readonly parameter_path="/dailydraft/api/prod/"
readonly image_key="${1:-}"
readonly sha="${2:-}"

if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full lowercase Git SHA as the second argument" >&2
  exit 2
fi

if [[ "$image_key" != "images/dailydraft-${sha}.tar.gz" ]]; then
  echo "Image key does not match the requested Git SHA" >&2
  exit 2
fi

readonly image="dailydraft:${sha}"
readonly container="api-dailydraft-fun"
readonly candidate="${container}-candidate"
readonly environment_directory="/etc/dailydraft"
readonly environment_file="${environment_directory}/dailydraft.env"
readonly unit_directory="/etc/systemd/system"
readonly artifact_directory="/var/lib/dailydraft"

install -d -m 700 "$environment_directory" "$artifact_directory"
temporary_environment="$(mktemp "${environment_directory}/dailydraft.env.XXXXXX")"
artifact_file="$(mktemp "${artifact_directory}/dailydraft.XXXXXX.tar.gz")"
trap 'rm -f "$temporary_environment" "$artifact_file"' EXIT
umask 077

parameter_rows="$(
  aws ssm get-parameters-by-path \
    --path "$parameter_path" \
    --recursive \
    --with-decryption \
    --region "$aws_region" \
    --query "Parameters[].[Name,Value]" \
    --output text
)"

if [[ -z "$parameter_rows" || "$parameter_rows" == "None" ]]; then
  echo "No SSM parameters found under ${parameter_path}" >&2
  exit 1
fi

caddy_network_override=""
declare -A seen_keys=()
while IFS=$'\t' read -r parameter_name parameter_value; do
  [[ -n "$parameter_name" ]] || continue
  if [[ "$parameter_name" != /* ]]; then
    echo "SSM values must be single-line strings" >&2
    exit 1
  fi

  parameter_key="${parameter_name##*/}"
  if [[ ! "$parameter_key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Invalid environment key from SSM: ${parameter_key}" >&2
    exit 1
  fi
  if [[ -n "${seen_keys[$parameter_key]:-}" ]]; then
    echo "Duplicate SSM parameter leaf: ${parameter_key}" >&2
    exit 1
  fi
  seen_keys["$parameter_key"]=1

  case "$parameter_key" in
    DB_MASTER_PASSWORD|API_DOMAIN)
      continue
      ;;
    CADDY_NETWORK)
      # Host-side routing control, not application configuration. Kept out of the
      # container environment and used only to disambiguate the Docker network
      # when shipshit-caddy fronts more than one tenant network.
      caddy_network_override="$parameter_value"
      continue
      ;;
  esac

  printf '%s=%s\n' "$parameter_key" "$parameter_value" >>"$temporary_environment"
done <<<"$parameter_rows"

printf '%s\n' "NODE_ENV=production" "PORT=3000" >>"$temporary_environment"
install -m 600 "$temporary_environment" "$environment_file"

# One network name per line. A bare {{$k}} range concatenates every name into a
# single unusable string as soon as shipshit-caddy fronts a second tenant network.
caddy_networks=()
while IFS= read -r caddy_network; do
  [[ -n "$caddy_network" ]] && caddy_networks+=("$caddy_network")
done < <(
  docker inspect \
    -f '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' \
    shipshit-caddy
)

if [[ ${#caddy_networks[@]} -eq 0 ]]; then
  echo "shipshit-caddy is not attached to a Docker network" >&2
  exit 1
fi

if [[ -n "$caddy_network_override" ]]; then
  network=""
  for caddy_network in "${caddy_networks[@]}"; do
    if [[ "$caddy_network" == "$caddy_network_override" ]]; then
      network="$caddy_network"
      break
    fi
  done
  if [[ -z "$network" ]]; then
    echo "CADDY_NETWORK is ${caddy_network_override} but shipshit-caddy is only on: ${caddy_networks[*]}" >&2
    exit 1
  fi
elif [[ ${#caddy_networks[@]} -gt 1 ]]; then
  # Guessing here would attach the API to a network Caddy cannot reach it on,
  # which fails as a silent 502 rather than a failed deploy.
  echo "shipshit-caddy is on ${#caddy_networks[@]} networks (${caddy_networks[*]}); set ${parameter_path}CADDY_NETWORK to choose one" >&2
  exit 1
else
  network="${caddy_networks[0]}"
fi

aws s3 cp \
  "s3://${artifact_bucket}/${image_key}" \
  "$artifact_file" \
  --region "$aws_region" \
  --only-show-errors
gunzip -c "$artifact_file" | docker load
docker image inspect "$image" >/dev/null

docker run --rm \
  --network "$network" \
  --env-file "$environment_file" \
  "$image" \
  bun --filter @dailydraft/db db:deploy

docker rm -f "$candidate" >/dev/null 2>&1 || true
docker run -d \
  --name "$candidate" \
  --network "$network" \
  --env-file "$environment_file" \
  --restart no \
  "$image" >/dev/null

candidate_healthy=false
for _ in $(seq 1 30); do
  if docker exec "$candidate" bun -e \
    "await fetch('http://127.0.0.1:3000/v1/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
  then
    candidate_healthy=true
    break
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' "$candidate")" != "true" ]]; then
    break
  fi
  sleep 2
done

if [[ "$candidate_healthy" != "true" ]]; then
  echo "Candidate API failed its health check" >&2
  docker logs --tail 200 "$candidate" >&2 || true
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  exit 1
fi

docker rm -f "$container" >/dev/null 2>&1 || true
docker rename "$candidate" "$container"
docker update --restart unless-stopped "$container" >/dev/null
docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile

# This host is shared with other tenants, so an unbounded image set is a
# host-wide outage rather than a local one. docker images lists newest first;
# retain the running image plus the previous one for a fast manual rollback.
stale_images="$(
  docker images --filter reference='dailydraft:*' --format '{{.Repository}}:{{.Tag}}' \
    | grep -Fxv "$image" \
    | tail -n +2
)" || true
if [[ -n "$stale_images" ]]; then
  # Never prune host-wide; other tenants own the rest of the image store.
  xargs -r docker rmi >/dev/null 2>&1 <<<"$stale_images" || true
fi

# This host runs no cron daemon at all -- /etc/cron.d does not exist and cronie is
# not installed -- while systemd already drives every other scheduled job on it.
# Installing a cron daemon would be a host-wide change on a box shared with other
# tenants; namespaced units are not.
temporary_unit="$(mktemp)"
trap 'rm -f "$temporary_environment" "$artifact_file" "$temporary_unit"' EXIT

install_reconciliation_timer() {
  local job="$1" calendar="$2"
  local unit="dailydraft-reconcile-${job}"

  # docker exec inherits the environment the container was created with, so
  # CRON_SECRET is already present inside it. Re-reading the secret on the host and
  # passing it via -e would expose it in the host process table on every run.
  cat >"$temporary_unit" <<UNIT
[Unit]
Description=DailyDraft ${job} reconciliation
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec ${container} bun -e "const secret=process.env.CRON_SECRET; if(!secret){console.error('CRON_SECRET is not set inside the container');process.exit(1);} await fetch('http://127.0.0.1:3000/v1/internal/reconciliation/${job}',{headers:{Authorization:'Bearer '+secret}}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
UNIT
  install -m 644 "$temporary_unit" "${unit_directory}/${unit}.service"

  cat >"$temporary_unit" <<UNIT
[Unit]
Description=DailyDraft ${job} reconciliation schedule

[Timer]
OnCalendar=${calendar}
# The host reboots outside the window often enough that a missed run would
# otherwise wait a full day; catch up on boot instead.
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  install -m 644 "$temporary_unit" "${unit_directory}/${unit}.timer"
}

install_reconciliation_timer solana '*-*-* 03:00:00'
install_reconciliation_timer treasury '*-*-* 04:00:00'
systemctl daemon-reload
systemctl enable --now dailydraft-reconcile-solana.timer dailydraft-reconcile-treasury.timer >/dev/null

# The cron drop-in this replaced is inert without a cron daemon, but leaving it
# behind would silently double-fire if anyone ever installs one.
rm -f /etc/cron.d/dailydraft

echo "DailyDraft API deployed: ${image}"
