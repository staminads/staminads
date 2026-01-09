const fs = require('fs');
const path = require('path');

const sdkSource = path.join(__dirname, '../../sdk/dist/staminads.min.js');
const sdkDir = path.join(__dirname, '../public/sdk');

// Read version from api/src/version.ts (source of truth)
const versionFile = path.join(__dirname, '../../api/src/version.ts');
const versionContent = fs.readFileSync(versionFile, 'utf-8');
const match = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const version = match ? match[1] : '0.0.0';

const sdkDest = path.join(sdkDir, `staminads_${version}.min.js`);

// Create sdk directory if it doesn't exist
if (!fs.existsSync(sdkDir)) {
  fs.mkdirSync(sdkDir, { recursive: true });
}

// Check if source file exists
if (!fs.existsSync(sdkSource)) {
  console.error('SDK source file not found:', sdkSource);
  console.error('Run `npm run build` in the sdk directory first.');
  process.exit(1);
}

// Remove old versioned SDK files
const existingFiles = fs.readdirSync(sdkDir);
for (const file of existingFiles) {
  if (file.match(/^staminads_[\d.]+\.min\.js$/)) {
    fs.unlinkSync(path.join(sdkDir, file));
    console.log(`Removed old SDK: ${file}`);
  }
}

// Copy the SDK file with versioned name
fs.copyFileSync(sdkSource, sdkDest);
console.log(`SDK copied to public/sdk/staminads_${version}.min.js`);
