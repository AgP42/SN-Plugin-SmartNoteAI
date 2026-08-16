// The one job of this test: make it IMPOSSIBLE to bump the release without
// bumping the constant the diagnostic log stamps into every bug report.
import {APP_VERSION, APP_VERSION_CODE} from './version';

const config = require('../../PluginConfig.json') as {
  versionName: string;
  versionCode: string;
};
const pkg = require('../../package.json') as {version: string};

describe('version constant', () => {
  it('matches PluginConfig.json — the shipped identity', () => {
    expect(APP_VERSION).toBe(config.versionName);
    expect(APP_VERSION_CODE).toBe(config.versionCode);
  });

  // Close the F-01 gap (audit 2026-08-15): the artifact name is built from
  // package.json, so a divergence there = a mislabelled .snplg. Fail CI on it.
  it('matches package.json — so the built artifact can never be mislabelled', () => {
    expect(pkg.version).toBe(config.versionName);
  });

  it('is a plain x.y.z, so a log header is never ambiguous', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
