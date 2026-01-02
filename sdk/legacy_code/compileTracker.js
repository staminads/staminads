const fs = require('fs');
const UglifyJS = require('uglify-js');

// Read the sdj file
const trackerCode = fs.readFileSync('sdk.js', 'utf8');

// Uglify options
const uglifyOptions = {
  mangle: true,
  compress: {
    dead_code: true,
    drop_debugger: true,
    conditionals: true,
    evaluate: true,
    booleans: true,
    loops: true,
    unused: true,
    hoist_funs: true,
    keep_fargs: false,
    hoist_vars: true,
    if_return: true,
    join_vars: true,
    // cascade: true,
    side_effects: true,
    // warnings: false
  }
};

try {
  // Minify the code
  const result = UglifyJS.minify(trackerCode, uglifyOptions);

  if (result.error) {
    console.error('Error during minification:', result.error);
  } else {
    // Write the minified code to a new file
    fs.writeFileSync('staminads.min.js', result.code, 'utf8');
    console.log('Minification complete. Output written to staminads.min.js');

    // Log file size reduction
    const originalSize = Buffer.byteLength(trackerCode, 'utf8');
    const minifiedSize = Buffer.byteLength(result.code, 'utf8');
    const reductionPercentage = ((originalSize - minifiedSize) / originalSize * 100).toFixed(2);

    console.log(`Original size: ${originalSize} bytes`);
    console.log(`Minified size: ${minifiedSize} bytes`);
    console.log(`Size reduction: ${reductionPercentage}%`);
  }
} catch (error) {
  console.error('An error occurred during the minification process:', error);
}