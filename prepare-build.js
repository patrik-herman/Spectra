// Predpripraví Spectru pre Electron.

const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, 'app');

console.log('Preparing Spectra for desktop build...');

if (!fs.existsSync(appDir)) {
    console.error('Error: app/ folder not found. Run the build script first.');
    process.exit(1);
}

const processorSource = path.join(appDir, 'shared', 'src', 'js', 'audio', 'additive-processor.js');
const processorTarget = path.join(appDir, 'additive-processor.js');

if (!fs.existsSync(processorSource)) {
    console.warn('Warning: additive-processor.js not found at expected location');
} else if (!fs.existsSync(processorTarget)) {
    fs.copyFileSync(processorSource, processorTarget);
    console.log('Copied additive-processor.js to app root for desktop mode');
} else {
    const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    if (norm(processorSource) === norm(processorTarget)) {
        console.log('additive-processor.js already at app root and identical, nothing to do');
    } else {
        console.log('additive-processor.js at app root DIFFERS from the shared copy and was kept.');
        console.log('-> kept:   app/additive-processor.js (what the desktop AudioWorklet loads)');
        console.log('-> source: app/shared/src/js/audio/additive-processor.js');
        console.log('-> To adopt the shared version deliberately, delete the root copy and run this again.');
    }
}

console.log('Done! Ready to run electron-builder.');
