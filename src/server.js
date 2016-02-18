// vile/server.js
var _ 		= require('lodash');
var colors 	= require('colors');
var express 	= require('express');
var bodyParser 	= require('body-parser')
var cors 	= require('cors')
var fs 		= require('fs');
var path 	= require('path');
var compression = require('compression')
var http 	= require('http');
var config 	= require('../config/pile-config'); // config
var request 	= require('request');
var winston 	= require('winston');
var port 	= config.port; // port for tileserver (nginx proxied)

// #########################################
// ###  Server, routes                   ###	// runs on 1 cpu
// #########################################
module.exports = function (pile) {

	// configure server
	var app = express();
	app.use(compression()); // enable compression
	app.use(bodyParser.json({ limit: '1000mb'}));
	app.use(express.static(path.join(__dirname, 'public'))); 	// not secured

	// create layer
	app.post('/v2/tiles/create', checkAccess, function (req, res) {
		pile.createLayer(req, res);
	});

	// vectorize layer
	app.post('/v2/tiles/vectorize', checkAccess, function (req, res) {
		pile.vectorizeLayer(req, res);
	});

	// update layer
	app.post('/v2/tiles/update', checkAccess, function (req, res) {
		pile.updateLayer(req, res);
	});

	// get layer
	app.get('/v2/tiles/layer', checkAccess, function (req, res) {
		pile.getLayer(req, res);
	});

	// get tiles
	app.get('/v2/tiles/*', checkAccess, function (req, res) {
		pile.getTile(req, res);
	});

	// // get tiles
	// app.get('/v2/tiles/*', checkAccess, function (req, res) {
	// 	pile.getOverlayTile(req, res);
	// });						// must be detected which type layer - tile, proxy, grid, overlay

	// get data from point
	app.post('/v2/query/point', checkAccess, function (req, res) {
		pile.fetchData(req, res);
	});

	// get data from area
	app.post('/v2/query/polygon', checkAccess, function (req, res) {
		pile.fetchDataArea(req, res);
	});

	// get histogram from column
	app.post('/v2/query/histogram', checkAccess, function (req, res) {
		pile.fetchHistogram(req, res);
	});

	// // proxy tiles
	// app.get('/proxy/*', checkAccess, function (req, res) {
	// 	pile.proxyTile(req, res);
	// });

	// start server
	app.listen(port);

	// debug
	console.log('PostGIS tileserver is up @ ' + port);
}


// helper fn's for auth
function checkAccess (req, res, next) {
	var access_token = req.query.access_token || req.body.access_token;

	// request wu for checking access tokens
	// var verifyUrl = 'http://wu:3001/api/token/check?access_token=' + access_token;
	var verifyUrl = 'http://wu:3001/v2/users/token/check?access_token=' + access_token;
	request(verifyUrl, function (error, response, body) {
		if (!response) return res.json({access : 'Unauthorized'});
		
		try {
			var status = JSON.parse(body);
		} catch (e) {
			var status = false;
		}

		// allowed
		if (response.statusCode == 200 && !error && status && status.valid) {
			return next();
		} 

		// check if raster request
		if (req._parsedUrl && req._parsedUrl.pathname) {
			var parsed = req._parsedUrl.pathname.split('/');
			if (parsed[5]) {
				var ext = parsed[5].split('.');
				if (ext.length > 0) {
					var type = ext[1];
					if (type == 'png') {
						// serve noAccessTile
						return fs.readFile('public/noAccessTile.png', function (err, tile) {
							res.writeHead(200, {'Content-Type': 'image/png'});
							res.end(tile);
						});
					}
				}
			}
		}

		// not allowed
		res.json({access : 'Unauthorized'});
	});
}

console.tile = console.info;
console.tile = function (tile) {
	if (tile.render_time) console.info('rendered tile in ', tile.render_time, 'ms');
};
