// The one job of this test: make it IMPOSSIBLE to bump the release without
// bumping the constant the diagnostic log stamps into every bug report.
import {APP_VERSION, APP_VERSION_CODE} from './version';

const config = require('../../PluginConfig.json') as {
  versionName: string;
  versionCode: string;
};

describe('version constant', () => {
  it('matches PluginConfig.json — the shipped identity', () => {
    expect(APP_VERSION).toBe(config.versionName);
    expect(APP_VERSION_CODE).toBe(config.versionCode);
  });

  it('is a plain x.y.z, so a log header is never ambiguous', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
