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

describe('production reverse-proxy identity contract', () => {
  test('derives the exact trusted peer from the selected Docker network', () => {
    expect(deployScript).toContain('caddy_network_addresses["$caddy_network"]="$caddy_address"');
    expect(deployScript).toContain('trusted_proxy=');
    expect(deployScript).toContain('caddy_network_addresses[$network]');
    expect(deployScript).toContain('DAILYDRAFT_TRUSTED_PROXIES=');
    expect(deployScript).toContain('CADDY_NETWORK|DAILYDRAFT_TRUSTED_PROXIES)');
  });

  test('overwrites spoofable forwarding headers at the trusted edge', () => {
    expect(caddyFragment).toContain('header_up X-Forwarded-For {remote_host}');
    expect(caddyFragment).toContain('header_up X-Forwarded-Host {host}');
    expect(caddyFragment).toContain('header_up X-Forwarded-Proto {scheme}');
  });
});
