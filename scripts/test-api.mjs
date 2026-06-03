import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const VeSync = require('../dist/api/VeSync').default;
const DebugMode = require('../dist/debugMode').default;

const config = JSON.parse(readFileSync(`${process.env.HOME}/.homebridge/config.json`, 'utf8'));
const platform = config.platforms.find((p) => p.platform === 'LevoitAirPurifiers');

if (!platform?.email || !platform?.password) {
  console.error('Missing VeSync credentials in ~/.homebridge/config.json');
  process.exit(1);
}

const log = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
};

const debugMode = new DebugMode(true, log);
const client = new VeSync(platform.email, platform.password, debugMode, log);
const loginOk = await client.startSession();

console.log('login:', loginOk);

if (!loginOk) {
  process.exit(1);
}

const { purifiers, humidifiers } = await client.getDevices();
const core200s = purifiers.find((fan) => fan.model.includes('200S'));

console.log('purifiers:', purifiers.length, purifiers.map((fan) => ({
  name: fan.name,
  model: fan.model,
  isOn: fan.isOn,
  speed: fan.speed,
  mode: fan.mode,
})));
console.log('humidifiers:', humidifiers.length);

if (!core200s) {
  console.error('No Core 200S purifier found');
  process.exit(1);
}

await core200s.updateInfo();

console.log('core200s after update:', {
  name: core200s.name,
  model: core200s.model,
  isOn: core200s.isOn,
  speed: core200s.speed,
  mode: core200s.mode,
  filterLife: core200s.filterLife,
  childLock: core200s.childLock,
  screenVisible: core200s.screenVisible,
});

process.exit(0);
