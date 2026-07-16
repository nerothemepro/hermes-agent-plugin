import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('HerResearch installer exposes only the bounded hotel-search browser surface', () => {
  const installer = read('scripts/install_herresearch_profile.sh');
  for (const tool of [
    'browser_type',
    'browser_fill_form',
    'browser_select_option',
    'browser_tabs',
    'browser_take_screenshot',
  ]) {
    assert.match(installer, new RegExp(`- ${tool}\\b`));
  }
  for (const unsafeTool of [
    'browser_run_code_unsafe',
    'browser_evaluate',
    'browser_file_upload',
  ]) {
    assert.doesNotMatch(installer, new RegExp(`- ${unsafeTool}\\b`));
  }
});

test('hotel availability skill routes Jalan deterministically and forbids booking', () => {
  const skill = read('skills/japan-hotel-availability/SKILL.md');
  assert.match(skill, /\/workspace\/jalan-room-search-tool\/bin\/jalan-room-search/);
  assert.match(skill, /Booking\.com/);
  assert.match(skill, /Airbnb/);
  assert.match(skill, /checked_at/);
  assert.match(skill, /max_results_per_site/);
  assert.match(skill, /không đặt phòng/i);
  assert.match(skill, /CAPTCHA/);
});

test('profile installer installs the hotel skill without secret literals', () => {
  const installer = read('scripts/install_herresearch_profile.sh');
  assert.match(installer, /skills\/research\/japan-hotel-availability/);
  assert.match(installer, /skills\/japan-hotel-availability\/\./);
  const deploymentInstaller = read('scripts/install_herresearch_hotel_availability.sh');
  assert.match(deploymentInstaller, /rollback\.sh/);
  assert.doesNotMatch(installer + deploymentInstaller, /TAVILY_API_KEY=[A-Za-z0-9_-]{20,}/);
});

test('native Telegram command bypasses LLM routing and is deployed reversibly', () => {
  const plugin = read('hermes-plugin/japan_hotel_research/__init__.py');
  const manifest = read('hermes-plugin/japan_hotel_research/plugin.yaml');
  const bookingServer = read('hermes-plugin/japan_hotel_research/booking_mcp_server.sh');
  const bookingConfig = read('hermes-plugin/japan_hotel_research/booking-playwright-mcp.json');
  const deploymentInstaller = read('scripts/install_herresearch_hotel_availability.sh');
  const profileInstaller = read('scripts/install_herresearch_profile.sh');

  assert.match(plugin, /register_command\(\s*["']japan-hotel-research["']/s);
  assert.match(manifest, /name:\s*japan-hotel-research/);
  assert.match(bookingServer, /xvfb-run/);
  assert.match(bookingConfig, /"headless": false/);
  assert.match(deploymentInstaller, /xvfb-run/);
  assert.match(profileInstaller, /xvfb-run/);
  assert.match(deploymentInstaller, /plugins\/japan-hotel-research/);
  assert.match(deploymentInstaller, /plugins\.enabled|setdefault\(["']plugins["']/);
  assert.match(deploymentInstaller, /rollback\.sh/);
  assert.match(profileInstaller, /japan_hotel_research/);
  assert.doesNotMatch(profileInstaller + deploymentInstaller, /TELEGRAM_BOT_TOKEN=[A-Za-z0-9:_-]{20,}/);
});
