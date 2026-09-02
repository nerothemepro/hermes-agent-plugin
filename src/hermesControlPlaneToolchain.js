'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TOOLCHAIN_ROOT = '/opt/data/hermes/control-plane/video-dogfood/toolchain';
const STAGED_PACKAGES = new Set(['sdtk-agent-kit', 'sdtk-agent-hermes-adapter']);

function toolchainRoot(environment = process.env) {
  return environment.SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT || DEFAULT_TOOLCHAIN_ROOT;
}

function activeReleaseDir(environment = process.env) {
  const root = toolchainRoot(environment);
  const pointer = path.join(root, 'active-release');
  if (!fs.existsSync(pointer)) return null;
  const releaseId = fs.readFileSync(pointer, 'utf8').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(releaseId)) throw new Error('invalid active staged release');
  const releaseDir = path.join(root, 'releases', releaseId);
  if (!fs.existsSync(path.join(releaseDir, 'release.json'))) throw new Error('active staged release is unavailable');
  return releaseDir;
}

function activeAgentCommand(projectPath, environment = process.env) {
  const releaseDir = activeReleaseDir(environment);
  const wrapper = path.join(path.resolve(projectPath), 'control-plane', 'video-dogfood', 'staging', 'with-active-toolchain.sh');
  if (releaseDir && fs.existsSync(wrapper)) return [wrapper, 'sdtk-agent'];
  return ['sdtk-agent'];
}

function activeToolchainEnvironment(environment = process.env) {
  const releaseDir = activeReleaseDir(environment);
  if (!releaseDir) return { ...environment };
  const bin = path.join(releaseDir, 'node_modules', '.bin');
  const modules = path.join(releaseDir, 'node_modules');
  return { ...environment, PATH: bin + (environment.PATH ? ':' + environment.PATH : ''), NODE_PATH: modules + (environment.NODE_PATH ? ':' + environment.NODE_PATH : '') };
}

function activePackageVersion(packageName, environment = process.env) {
  if (!STAGED_PACKAGES.has(packageName)) return null;
  const releaseDir = activeReleaseDir(environment);
  if (!releaseDir) return null;
  const packagePath = path.join(releaseDir, 'node_modules', packageName, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return typeof packageJson.version === 'string' ? packageJson.version : null;
}

module.exports = { DEFAULT_TOOLCHAIN_ROOT, activeAgentCommand, activePackageVersion, activeReleaseDir, activeToolchainEnvironment };
