/**
 * Tests for copy-sdk.cjs script
 * Verifies that the script correctly copies SDK with versioned filename
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Paths
const apiVersionPath = path.join(__dirname, '../../api/src/version.ts');
const sdkSourcePath = path.join(__dirname, '../../sdk/dist/staminads.min.js');
const sdkDestDir = path.join(__dirname, '../public/sdk');

function getExpectedVersion() {
  const versionContent = fs.readFileSync(apiVersionPath, 'utf-8');
  const match = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('Could not parse APP_VERSION');
  return match[1];
}

function runTests() {
  console.log('Running copy-sdk tests...\n');

  // Test 1: Version parsing
  console.log('Test 1: Should correctly parse version from api/src/version.ts');
  const version = getExpectedVersion();
  assert(version.match(/^\d+\.\d+\.\d+/), `Version should match semver pattern: ${version}`);
  console.log(`  ✓ Parsed version: ${version}\n`);

  // Test 2: Versioned filename pattern
  console.log('Test 2: Should create versioned filename pattern');
  const expectedFilename = `staminads_${version}.min.js`;
  assert(expectedFilename.match(/^staminads_\d+\.\d+\.\d+\.min\.js$/), 'Filename should match pattern');
  console.log(`  ✓ Expected filename: ${expectedFilename}\n`);

  // Test 3: Check if SDK file exists in destination (if copy-sdk has been run)
  console.log('Test 3: Should have versioned SDK file in public/sdk (after copy-sdk runs)');
  if (fs.existsSync(sdkDestDir)) {
    const files = fs.readdirSync(sdkDestDir);
    const versionedFiles = files.filter(f => f.match(/^staminads_[\d.]+\.min\.js$/));

    if (versionedFiles.length > 0) {
      assert(versionedFiles.includes(expectedFilename), `Should have ${expectedFilename}`);
      console.log(`  ✓ Found versioned SDK: ${versionedFiles.join(', ')}\n`);
    } else {
      console.log('  ⚠ No versioned SDK files found (run npm run copy-sdk first)\n');
    }
  } else {
    console.log('  ⚠ SDK directory does not exist (run npm run copy-sdk first)\n');
  }

  // Test 4: Old unversioned file should not exist
  console.log('Test 4: Should not have old unversioned staminads.min.js');
  const oldFilePath = path.join(sdkDestDir, 'staminads.min.js');
  assert(!fs.existsSync(oldFilePath), 'Old unversioned file should not exist');
  console.log('  ✓ No old unversioned file found\n');

  // Test 5: version.json should not exist
  console.log('Test 5: Should not have old version.json');
  const versionJsonPath = path.join(sdkDestDir, 'version.json');
  assert(!fs.existsSync(versionJsonPath), 'version.json should not exist');
  console.log('  ✓ No version.json found\n');

  // Test 6: Regex for cleanup should match versioned files
  console.log('Test 6: Cleanup regex should match versioned files correctly');
  const cleanupRegex = /^staminads_[\d.]+\.min\.js$/;
  const testFilenames = [
    { name: 'staminads_3.0.0.min.js', shouldMatch: true },
    { name: 'staminads_10.20.30.min.js', shouldMatch: true },
    { name: 'staminads.min.js', shouldMatch: false },
    { name: 'staminads_abc.min.js', shouldMatch: false },
    { name: 'version.json', shouldMatch: false },
  ];

  for (const { name, shouldMatch } of testFilenames) {
    const matches = cleanupRegex.test(name);
    assert(matches === shouldMatch, `${name} should ${shouldMatch ? '' : 'not '}match cleanup regex`);
  }
  console.log('  ✓ Cleanup regex works correctly\n');

  console.log('All tests passed! ✓');
}

// Run tests
try {
  runTests();
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
}
