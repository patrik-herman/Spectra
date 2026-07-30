var pngToIco = require('png-to-ico');
var fs = require('fs');
var path = require('path');

var inputPath = path.join(__dirname, 'assets', 'icon.png');
var outputPath = path.join(__dirname, 'assets', 'icon.ico');

var convert = pngToIco.default || pngToIco;

convert(inputPath)
	.then(buf => {
		fs.writeFileSync(outputPath, buf);
		console.log('Generated icon.ico successfully');
	})
	.catch(err => {
		console.error('Error generating icon:', err);
		process.exit(1);
	});
