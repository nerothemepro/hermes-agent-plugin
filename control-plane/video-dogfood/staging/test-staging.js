'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const STAGING = __dirname;

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || command + ' failed');
  return result.stdout.trim();
}

function makePackage(root, name, version, binName) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const pkg = { name, version, main: 'index.js' };
  if (binName) pkg.bin = { [binName]: 'cli.js' };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};\n');
  if (binName) {
    fs.writeFileSync(path.join(dir, 'cli.js'), `#!/usr/bin/env node\nconsole.log('${binName} ${version}');\n`, { mode: 0o755 });
  }
  const filename = run('npm', ['pack', '--silent'], { cwd: dir }).split('\n').pop();
  return path.join(dir, filename);
}

test('staging installs immutable local releases and activation can roll back without deletion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dogfood-toolchain-'));
  const packages = path.join(root, 'packages');
  const toolchain = path.join(root, 'toolchain');
  fs.mkdirSync(packages);
  const core = makePackage(packages, 'sdtk-agent-kit', '9.9.1', 'sdtk-agent');
  const adapter = makePackage(packages, 'sdtk-agent-hermes-adapter', '9.9.2');
  const env = { ...process.env, SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT: toolchain };
  try {
    run('bash', [path.join(STAGING, 'install-release.sh'), 'release-a', core, adapter], { env });
    run('bash', [path.join(STAGING, 'verify-release.sh'), 'release-a'], { env });
    run('bash', [path.join(STAGING, 'activate-release.sh'), 'release-a'], { env });
    assert.strictEqual(fs.readFileSync(path.join(toolchain, 'active-release'), 'utf8').trim(), 'release-a');
    const releaseA = path.join(toolchain, 'releases', 'release-a');
    assert.ok(fs.existsSync(path.join(releaseA, 'artifacts', 'sdtk-agent-kit.tgz')));
    assert.ok(fs.existsSync(path.join(releaseA, 'artifacts', 'sdtk-agent-hermes-adapter.tgz')));
    assert.match(run('bash', [path.join(STAGING, 'with-active-toolchain.sh'), 'sdtk-agent', '--version'], { env }), /9\.9\.1/);

    run('bash', [path.join(STAGING, 'install-release.sh'), 'release-b', core, adapter], { env });
    run('bash', [path.join(STAGING, 'activate-release.sh'), 'release-b'], { env });
    run('bash', [path.join(STAGING, 'activate-release.sh'), 'release-a'], { env });
    const backups = fs.readdirSync(path.join(toolchain, 'activation-backups'));
    assert.ok(backups.length >= 3);
    const latestBackup = JSON.parse(fs.readFileSync(path.join(toolchain, 'activation-backups', backups.sort().pop()), 'utf8'));
    assert.strictEqual(latestBackup.previous_release_id, 'release-b');
    assert.strictEqual(latestBackup.activated_release_id, 'release-a');
    assert.ok(fs.existsSync(path.join(toolchain, 'releases', 'release-a')));
    assert.ok(fs.existsSync(path.join(toolchain, 'releases', 'release-b')));
    assert.strictEqual(fs.readFileSync(path.join(toolchain, 'active-release'), 'utf8').trim(), 'release-a');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
