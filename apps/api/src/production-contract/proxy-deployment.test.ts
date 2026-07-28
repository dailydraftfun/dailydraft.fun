import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const deployScript = readFileSync(
  new URL('../../../../deploy/dailydraft/deploy-dailydraft.sh', import.meta.url),
  'utf8',
);
const caddyFragment = readFileSync(
  new URL('../../../../deploy/dailydraft/Caddyfile.fragment', import.meta.url),
  'utf8',
);
const deployWorkflow = readFileSync(
  new URL('../../../../.github/workflows/deploy-api-production.yml', import.meta.url),
  'utf8',
);

describe('production reverse-proxy identity contract', () => {
  test('uses a stable Docker DNS identity instead of snapshotting Caddy IP', () => {
    expect(deployScript).toContain('DAILYDRAFT_TRUSTED_PROXY_HOSTS=shipshit-caddy');
    expect(deployScript).toContain(
      'CADDY_NETWORK|DAILYDRAFT_TRUSTED_PROXIES|DAILYDRAFT_TRUSTED_PROXY_HOSTS)',
    );
    expect(deployScript).not.toContain('caddy_network_addresses[');
    expect(deployScript).not.toContain(`DAILYDRAFT_TRUSTED_PROXIES=$${'{'}trusted_proxy}`);
  });

  test('overwrites spoofable forwarding headers at the trusted edge', () => {
    expect(caddyFragment).toContain('header_up X-Forwarded-For {remote_host}');
    expect(caddyFragment).toContain('header_up X-Forwarded-Host {host}');
    expect(caddyFragment).toContain('header_up X-Forwarded-Proto {scheme}');
  });

  test('ships and installs the exact-head Caddy fragment before validated reload', () => {
    expect(deployWorkflow).toContain(
      `"s3://$${'{'}ARTIFACT_BUCKET}/fragments/dailydraft-$${'{'}GITHUB_SHA}.caddy"`,
    );
    expect(deployWorkflow).toContain('--arg caddy_fragment_key "$caddy_fragment_key"');
    expect(deployWorkflow).toContain(
      '/usr/local/bin/deploy-dailydraft \\($image_key|@sh) \\($sha|@sh) \\($caddy_fragment_key|@sh)',
    );
    expect(deployScript).toContain(
      `if [[ "$caddy_fragment_key" != "fragments/dailydraft-$${'{'}sha}.caddy" ]]`,
    );
    expect(deployScript).toContain(`readonly caddy_fragment_name="dailydraft-$${'{'}sha}.caddy"`);
    expect(deployScript).toContain('print "import " fragment');
    const hostLock = deployScript.indexOf('flock -w 120 9');
    const candidateRemoval = deployScript.indexOf('docker rm -f "$candidate"');
    expect(hostLock).toBeGreaterThan(-1);
    expect(candidateRemoval).toBeGreaterThan(hostLock);
    expect(deployScript).toContain('cmp -s "$caddy_main_backup" "$caddy_main_source"');
    expect(deployScript).toContain('trap cleanup EXIT');
    expect(deployScript).toContain(
      'if [[ "$cutover_started" == "true" && "$release_committed" != "true" ]]',
    );
    expect(deployScript).toContain(
      'if [[ "$caddy_main_installed" == "true" && "$release_committed" != "true" ]]',
    );
    expect(deployScript).toContain(
      'dd if="$caddy_main_backup" of="$caddy_main_source" conv=fsync status=none || true',
    );
    expect(deployScript).toContain('docker rename "$container" "$previous_container"');
    expect(deployScript).toContain(
      'docker rename "$previous_container" "$container" >/dev/null 2>&1 || true',
    );

    const candidateValidation = deployScript.indexOf(
      `caddy validate --config "/config/$${'{'}caddy_candidate_name}"`,
    );
    const liveValidation = deployScript.indexOf('caddy validate --config /etc/caddy/Caddyfile');
    const reload = deployScript.indexOf(
      'caddy reload --config /etc/caddy/Caddyfile',
      liveValidation,
    );
    expect(candidateValidation).toBeGreaterThan(-1);
    expect(liveValidation).toBeGreaterThan(candidateValidation);
    expect(reload).toBeGreaterThan(liveValidation);
  });
});
