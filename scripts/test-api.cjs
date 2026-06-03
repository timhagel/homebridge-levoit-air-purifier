const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.HOME, '.homebridge/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const platform = config.platforms.find((p) => p.platform === 'LevoitAirPurifiers');

if (!platform?.email || !platform?.password) {
  console.error('Missing credentials');
  process.exit(1);
}

const VeSync = require('../dist/api/VeSync').default;

class Logger {
  info(...args) { console.log('[INFO]', ...args); }
  warn(...args) { console.warn('[WARN]', ...args); }
  error(...args) { console.error('[ERROR]', ...args); }
}

const debugMode = {
  debug: (...args) => console.log('[DEBUG]', ...args)
};

(async () => {
  const client = new VeSync(platform.email, platform.password, debugMode, new Logger());
  const loggedIn = await client.startSession();

  if (!loggedIn) {
    console.error('Login failed');
    process.exit(1);
  }

  console.log('Login OK');

  const { purifiers, humidifiers } = await client.getDevices();
  console.log(`Found ${purifiers.length} purifier(s), ${humidifiers.length} humidifier(s)`);

  for (const fan of purifiers) {
    console.log('---');
    console.log('name:', fan.name);
    console.log('model:', fan.model);
    console.log('configModule:', fan.configModule);
    console.log('isOn:', fan.isOn);
    console.log('speed:', fan.speed);
    console.log('mode:', fan.mode);
    await fan.updateInfo();
    console.log('after update - isOn:', fan.isOn, 'speed:', fan.speed, 'mode:', fan.mode, 'filter:', fan.filterLife);
  }
})();
