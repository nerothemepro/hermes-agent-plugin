'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install_herresearch_profile.sh'), 'utf8');

test('HerResearch profile includes file tools for bounded workflow artifacts on every active platform', () => {
  const config = installer.match(/cat >"\$PROFILE_HOME\/config\.yaml" <<'EOCFG'([\s\S]*?)^EOCFG$/m)?.[1] || '';
  assert.match(config, /toolsets:\n(?:.*\n)*?  - terminal\n  - file\n  - browser/);
  for (const platform of ['cli', 'telegram']) {
    const match = config.match(new RegExp('  ' + platform + ':\\n([\\s\\S]*?)(?=^  [a-z_]+:|^mcp_servers:)', 'm'));
    assert.ok(match, platform + ' platform toolsets are present');
    assert.match(match[1], /    - file/);
  }
});
