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
  esac

  printf '%s=%s\n' "$parameter_key" "$parameter_value" >>"$temporary_environment"
done <<<"$parameter_rows"

printf '%s\n' "NODE_ENV=production" "PORT=3000" >>"$temporary_environment"
install -m 600 "$temporary_environment" "$environment_file"

network="$(
  docker inspect \
    -f '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}}{{end}}' \
    shipshit-caddy
)"
if [[ -z "$network" ]]; then
  echo "shipshit-caddy is not attached to a Docker network" >&2
  exit 1
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

temporary_cron="$(mktemp /etc/cron.d/openpacksduel.XXXXXX)"
trap 'rm -f "$temporary_environment" "$artifact_file" "$temporary_cron"' EXIT
cat >"$temporary_cron" <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root CRON_SECRET="$(sed -n 's/^CRON_SECRET=//p' /etc/openpacksduel/openpacksduel.env | tail -n 1)" && test -n "$CRON_SECRET" && docker exec -e CRON_SECRET="$CRON_SECRET" openpacksduel bun -e "await fetch('http://127.0.0.1:3000/v1/internal/reconciliation/solana',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
0 4 * * * root CRON_SECRET="$(sed -n 's/^CRON_SECRET=//p' /etc/openpacksduel/openpacksduel.env | tail -n 1)" && test -n "$CRON_SECRET" && docker exec -e CRON_SECRET="$CRON_SECRET" openpacksduel bun -e "await fetch('http://127.0.0.1:3000/v1/internal/reconciliation/treasury',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CRON
install -m 644 "$temporary_cron" "$cron_file"

echo "OpenPacksDuel API deployed: ${image}"
