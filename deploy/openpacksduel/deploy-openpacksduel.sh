#!/usr/bin/env bash
set -euo pipefail

readonly artifact_bucket="openpacksduel-production-deploy-948918267147-us-west-1"
readonly aws_region="us-west-1"
readonly parameter_path="/openpacksduel/api/prod/"
readonly image_key="${1:-}"
readonly sha="${2:-}"

if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full lowercase Git SHA as the second argument" >&2
  exit 2
fi

if [[ "$image_key" != "images/openpacksduel-${sha}.tar.gz" ]]; then
  echo "Image key does not match the requested Git SHA" >&2
  exit 2
fi

readonly image="openpacksduel:${sha}"
readonly environment_directory="/etc/openpacksduel"
readonly environment_file="${environment_directory}/openpacksduel.env"
readonly cron_file="/etc/cron.d/openpacksduel"
readonly artifact_directory="/var/lib/openpacksduel"

install -d -m 700 "$environment_directory" "$artifact_directory"
temporary_environment="$(mktemp "${environment_directory}/openpacksduel.env.XXXXXX")"
artifact_file="$(mktemp "${artifact_directory}/openpacksduel.XXXXXX.tar.gz")"
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
  bun --filter @openpacksduel/db db:deploy

docker rm -f openpacksduel-candidate >/dev/null 2>&1 || true
docker run -d \
  --name openpacksduel-candidate \
  --network "$network" \
  --env-file "$environment_file" \
  --restart no \
  "$image" >/dev/null

candidate_healthy=false
for _ in $(seq 1 30); do
  if docker exec openpacksduel-candidate bun -e \
    "await fetch('http://127.0.0.1:3000/v1/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
  then
    candidate_healthy=true
    break
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' openpacksduel-candidate)" != "true" ]]; then
    break
  fi
  sleep 2
done

if [[ "$candidate_healthy" != "true" ]]; then
  echo "Candidate API failed its health check" >&2
  docker logs --tail 200 openpacksduel-candidate >&2 || true
  docker rm -f openpacksduel-candidate >/dev/null 2>&1 || true
  exit 1
fi

docker rm -f openpacksduel >/dev/null 2>&1 || true
docker rename openpacksduel-candidate openpacksduel
docker update --restart unless-stopped openpacksduel >/dev/null
docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile

# This host is shared with other tenants, so an unbounded image set is a
# host-wide outage rather than a local one. docker images lists newest first;
# retain the running image plus the previous one for a fast manual rollback.
stale_images="$(
  docker images --filter reference='openpacksduel:*' --format '{{.Repository}}:{{.Tag}}' \
    | grep -Fxv "$image" \
    | tail -n +2
)" || true
if [[ -n "$stale_images" ]]; then
  # Never prune host-wide; other tenants own the rest of the image store.
  xargs -r docker rmi >/dev/null 2>&1 <<<"$stale_images" || true
fi

temporary_cron="$(mktemp /etc/cron.d/openpacksduel.XXXXXX)"
trap 'rm -f "$temporary_environment" "$artifact_file" "$temporary_cron"' EXIT
# docker exec inherits the environment the container was created with, so
# CRON_SECRET is already present inside it. Re-reading the secret on the host and
# passing it via -e would expose it in the host process table on every run.
cat >"$temporary_cron" <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root docker exec openpacksduel bun -e "const secret=process.env.CRON_SECRET; if(!secret){console.error('CRON_SECRET is not set inside the container');process.exit(1);} await fetch('http://127.0.0.1:3000/v1/internal/reconciliation/solana',{headers:{Authorization:'Bearer '+secret}}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
0 4 * * * root docker exec openpacksduel bun -e "const secret=process.env.CRON_SECRET; if(!secret){console.error('CRON_SECRET is not set inside the container');process.exit(1);} await fetch('http://127.0.0.1:3000/v1/internal/reconciliation/treasury',{headers:{Authorization:'Bearer '+secret}}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CRON
install -m 644 "$temporary_cron" "$cron_file"

echo "OpenPacksDuel API deployed: ${image}"
