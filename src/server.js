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
var port 	= config.port; // port for tileserver (nginx proxied)
var request 	= require('request');

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
	app.post('/api/db/createLayer', checkAccess, function (req, res) {
		pile.createLayer(req, res);
	});

	// update layer
	app.post('/api/db/updateLayer', checkAccess, function (req, res) {
		pile.updateLayer(req, res);
	});

	// get layer
	app.get('/api/db/getLayer', checkAccess, function (req, res) {
		pile.getLayer(req, res);
	});

	// get tiles
	app.get('/tiles/*', checkAccess, function (req, res) {
		console.log('/tiles/*');
		pile.getTile(req, res);
	});

	// get data from point
	app.post('/api/db/fetch', checkAccess, function (req, res) {
		pile.fetchData(req, res);
	});

	// get data from area
	app.post('/api/db/fetchArea', checkAccess, function (req, res) {
		pile.fetchDataArea(req, res);
	});



	// proxy tiles
	app.get('/proxy/*', checkAccess, function (req, res) {
		console.log('/proxy/*');
		pile.proxyTile(req, res);
	});


	// start server
	app.listen(port);

	// debug
	console.log('PostGIS tileserver is up @ ', port);
}


// helper fn's for auth
function checkAccess (req, res, next) {
	var access_token = req.query.access_token || req.body.access_token;

	// request wu for checking access tokens
	var verifyUrl = 'http://wu:3001/api/token/check?access_token=' + access_token;
	request(verifyUrl, function (error, response, body) {
		if (!response) return res.json({access : 'Unauthorized'});
		
		// allowed
		if (response.statusCode == 200 && !error && body == 'OK') return next();

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















