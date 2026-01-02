const fs = require('fs');
const path = require('path');

const sdkSource = path.join(__dirname, '../../sdk/dist/staminads.min.js');
const sdkPackageJson = path.join(__dirname, '../../sdk/package.json');
const sdkDest = path.join(__dirname, '../public/sdk/staminads.min.js');
const versionDest = path.join(__dirname, '../public/sdk/version.json');

// Create sdk directory if it doesn't exist
const sdkDir = path.dirname(sdkDest);
if (!fs.existsSync(sdkDir)) {
  fs.mkdirSync(sdkDir, { recursive: true });
}

// Check if source file exists
if (!fs.existsSync(sdkSource)) {
  console.error('SDK source file not found:', sdkSource);
  console.error('Run `npm run build` in the sdk directory first.');
  process.exit(1);
}

// Read SDK version from package.json
const sdkPackage = JSON.parse(fs.readFileSync(sdkPackageJson, 'utf-8'));
const version = sdkPackage.version;

// Copy the SDK file
fs.copyFileSync(sdkSource, sdkDest);
console.log('SDK copied to public/sdk/staminads.min.js');

// Write version file
fs.writeFileSync(versionDest, JSON.stringify({ version }));
console.log(`SDK version ${version} written to public/sdk/version.json`);
