const fs = require('fs');
const path = require('path');

// Read version from api/src/version.ts
const versionFile = path.join(__dirname, '../../api/src/version.ts');
const versionContent = fs.readFileSync(versionFile, 'utf-8');
const match = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);

if (!match) {
  console.error('Could not parse APP_VERSION from api/src/version.ts');
  process.exit(1);
}

const version = match[1];

// Update sdk/package.json
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

if (packageJson.version !== version) {
  packageJson.version = version;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`SDK version synced to ${version}`);
} else {
  console.log(`SDK version already at ${version}`);
}
