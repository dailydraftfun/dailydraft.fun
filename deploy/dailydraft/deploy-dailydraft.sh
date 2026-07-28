#!/usr/bin/env bash
set -euo pipefail

readonly artifact_bucket="dailydraft-production-deploy-948918267147-us-west-1"
readonly aws_region="us-west-1"
readonly parameter_path="/dailydraft/api/prod/"
readonly image_key="${1:-}"
readonly sha="${2:-}"
readonly caddy_fragment_key="${3:-}"

if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full lowercase Git SHA as the second argument" >&2
  exit 2
fi

if [[ "$image_key" != "images/dailydraft-${sha}.tar.gz" ]]; then
  echo "Image key does not match the requested Git SHA" >&2
  exit 2
fi

if [[ "$caddy_fragment_key" != "fragments/dailydraft-${sha}.caddy" ]]; then
  echo "Caddy fragment key does not match the requested Git SHA" >&2
  exit 2
fi

readonly image="dailydraft:${sha}"
readonly container="api-dailydraft-fun"
readonly candidate="${container}-candidate"
readonly environment_directory="/etc/dailydraft"
readonly environment_file="${environment_directory}/dailydraft.env"
readonly unit_directory="/etc/systemd/system"
readonly artifact_directory="/var/lib/dailydraft"
readonly caddy_deploy_lock="/var/lock/dailydraft-caddy-deploy.lock"
readonly previous_container="${container}-previous"

install -d -m 700 "$environment_directory" "$artifact_directory"
exec 9>"$caddy_deploy_lock"
if ! flock -w 120 9; then
  echo "Timed out waiting for the DailyDraft host deployment lock" >&2
  exit 1
fi
temporary_environment="$(mktemp "${environment_directory}/dailydraft.env.XXXXXX")"
artifact_file="$(mktemp "${artifact_directory}/dailydraft.XXXXXX.tar.gz")"
caddy_fragment_file="$(mktemp "${artifact_directory}/dailydraft.XXXXXX.caddy")"
caddy_main_candidate="$(mktemp "${artifact_directory}/Caddyfile.XXXXXX")"
caddy_main_backup="$(mktemp "${artifact_directory}/Caddyfile.backup.XXXXXX")"
caddy_main_installed=false
candidate_promoted=false
cutover_started=false
previous_container_available=false
release_committed=false
cleanup() {
  if [[ "$release_committed" != "true" ]]; then
    docker rm -f "$candidate" >/dev/null 2>&1 || true
  fi
  if [[ "$cutover_started" == "true" && "$release_committed" != "true" ]]; then
    if [[ "$candidate_promoted" == "true" ]]; then
      docker rm -f "$container" >/dev/null 2>&1 || true
    fi
    if [[ "$previous_container_available" == "true" ]]; then
      docker rename "$previous_container" "$container" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "$caddy_main_installed" == "true" && "$release_committed" != "true" ]]; then
    dd if="$caddy_main_backup" of="$caddy_main_source" conv=fsync status=none || true
    docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile || true
  fi
  rm -f \
    "$temporary_environment" \
    "$artifact_file" \
    "$caddy_fragment_file" \
    "$caddy_main_candidate" \
    "$caddy_main_backup" \
    "${temporary_unit:-}"
}
trap cleanup EXIT
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
    CADDY_NETWORK|DAILYDRAFT_TRUSTED_PROXIES|DAILYDRAFT_TRUSTED_PROXY_HOSTS)
      # Host-side routing control, not application configuration. Kept out of the
      # container environment. The API trusts the stable Caddy Docker DNS identity,
      # not an SSM override or deploy-time IP snapshot.
      if [[ "$parameter_key" == "CADDY_NETWORK" ]]; then
        caddy_network_override="$parameter_value"
      fi
      continue
      ;;
  esac

  printf '%s=%s\n' "$parameter_key" "$parameter_value" >>"$temporary_environment"
done <<<"$parameter_rows"

# One network name per line. A bare {{$k}} range concatenates every name into a
# single unusable string as soon as shipshit-caddy fronts a second tenant network.
caddy_networks=()
while IFS=$'\t' read -r caddy_network _caddy_address; do
  if [[ -n "$caddy_network" ]]; then
    caddy_networks+=("$caddy_network")
  fi
done < <(
  docker inspect \
    -f '{{range $name,$settings := .NetworkSettings.Networks}}{{$name}}{{"\t"}}{{$settings.IPAddress}}{{"\n"}}{{end}}' \
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

printf '%s\n' \
  "NODE_ENV=production" \
  "PORT=3000" \
  "DAILYDRAFT_TRUSTED_PROXY_HOSTS=shipshit-caddy" \
  >>"$temporary_environment"
install -m 600 "$temporary_environment" "$environment_file"

aws s3 cp \
  "s3://${artifact_bucket}/${caddy_fragment_key}" \
  "$caddy_fragment_file" \
  --region "$aws_region" \
  --only-show-errors
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

# Caddy's main file is a read-only file bind inside the container, while /config
# is a persistent writable Docker volume. Keep immutable, exact-SHA fragments in
# that volume and import the exact release artifact from the shared main file.
# This survives Caddy recreation without coupling the API to Caddy's ephemeral IP.
IFS=$'\t' read -r caddy_config_source caddy_config_writable < <(
  docker inspect \
    -f '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{"\t"}}{{.RW}}{{end}}{{end}}' \
    shipshit-caddy
)
IFS=$'\t' read -r caddy_main_source _caddy_main_writable < <(
  docker inspect \
    -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{"\t"}}{{.RW}}{{end}}{{end}}' \
    shipshit-caddy
)
if [[ -z "$caddy_config_source" || "$caddy_config_writable" != "true" ]]; then
  echo "shipshit-caddy must have a writable persistent /config mount" >&2
  exit 1
fi
if [[ -z "$caddy_main_source" || ! -f "$caddy_main_source" ]]; then
  echo "shipshit-caddy must bind a host Caddyfile at /etc/caddy/Caddyfile" >&2
  exit 1
fi

readonly caddy_fragment_name="dailydraft-${sha}.caddy"
readonly caddy_fragment_target="${caddy_config_source}/${caddy_fragment_name}"
readonly caddy_candidate_name="dailydraft-Caddyfile-${sha}"
readonly caddy_candidate_target="${caddy_config_source}/${caddy_candidate_name}"

install -m 600 "$caddy_fragment_file" "$caddy_fragment_target"
cp -p "$caddy_main_source" "$caddy_main_backup"

# Replace either the managed import or the one legacy inline DailyDraft block.
# Refuse an unterminated block rather than risking another tenant's configuration.
if ! awk -v fragment="/config/${caddy_fragment_name}" '
  BEGIN {
    begin = "# BEGIN DAILYDRAFT MANAGED"
    end = "# END DAILYDRAFT MANAGED"
    legacy = "# Import into the shipshit-caddy Caddyfile. api.dailydraft.fun resolves to"
  }
  function managed_block() {
    print begin
    print "import " fragment
    print end
    emitted = 1
  }
  $0 == begin {
    if (!emitted) managed_block()
    in_managed = 1
    next
  }
  in_managed {
    if ($0 == end) in_managed = 0
    next
  }
  index($0, legacy) == 1 {
    if (!emitted) managed_block()
    in_legacy = 1
    next
  }
  in_legacy && $0 == "# BEGIN CORNERSHOPDEV" {
    in_legacy = 0
    print
    next
  }
  in_legacy { next }
  { print }
  END {
    if (in_managed || in_legacy) exit 42
    if (!emitted) {
      print ""
      managed_block()
    }
  }
' "$caddy_main_backup" >"$caddy_main_candidate"; then
  echo "Could not safely render the managed DailyDraft Caddy import" >&2
  exit 1
fi

install -m 600 "$caddy_main_candidate" "$caddy_candidate_target"
if ! docker exec shipshit-caddy caddy validate --config "/config/${caddy_candidate_name}"; then
  echo "Candidate Caddy configuration failed validation" >&2
  exit 1
fi

# The host is shared with deployments outside this repository. The lock prevents
# overlapping DailyDraft releases; this compare prevents overwriting another
# tenant that does not yet participate in the same host-wide lock.
if ! cmp -s "$caddy_main_backup" "$caddy_main_source"; then
  echo "Shared Caddyfile changed while preparing the DailyDraft import" >&2
  exit 1
fi
# Preserve the inode behind the live file bind. Caddy continues serving its
# already-loaded config until the validated replacement is explicitly reloaded.
caddy_main_installed=true
if ! dd if="$caddy_main_candidate" of="$caddy_main_source" conv=fsync status=none; then
  # A failed in-place write can leave the bind source truncated. Put the verified
  # prior bytes back before returning so a later Caddy restart cannot boot a
  # partially written shared-host configuration.
  dd if="$caddy_main_backup" of="$caddy_main_source" conv=fsync status=none || true
  echo "Could not install the managed Caddy import" >&2
  exit 1
fi
if ! docker exec shipshit-caddy caddy validate --config /etc/caddy/Caddyfile ||
  ! docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile
then
  dd if="$caddy_main_backup" of="$caddy_main_source" conv=fsync status=none
  caddy_main_installed=false
  docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile || true
  echo "Caddy validation or reload failed; restored the previous config" >&2
  exit 1
fi

docker rm -f "$previous_container" >/dev/null 2>&1 || true
cutover_started=true
if docker inspect "$container" >/dev/null 2>&1; then
  previous_container_available=true
  docker rename "$container" "$previous_container"
fi
candidate_promoted=true
if ! docker rename "$candidate" "$container"; then
  echo "Could not promote the candidate API container; restored the previous container" >&2
  exit 1
fi
if ! docker update --restart unless-stopped "$container" >/dev/null; then
  echo "Could not apply the live restart policy; restored the previous container" >&2
  exit 1
fi

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

release_committed=true
if [[ "$previous_container_available" == "true" ]]; then
  docker rm -f "$previous_container" >/dev/null 2>&1 || true
fi
echo "DailyDraft API deployed: ${image}"
