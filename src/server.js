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
	app.post('/api/db/createLayer', checkAccess, function (req, res) {
		pile.createLayer(req, res);
	});

	// vectorize layer
	app.post('/api/db/vectorizeLayer', checkAccess, function (req, res) {
		pile.vectorizeLayer(req, res);
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
		pile.getTile(req, res);
	});

	// get tiles
	app.get('/overlay_tiles/*', checkAccess, function (req, res) {
		pile.getOverlayTile(req, res);
	});

	// get data from point
	app.post('/api/db/fetch', checkAccess, function (req, res) {
		pile.fetchData(req, res);
	});

	// get data from area
	app.post('/api/db/fetchArea', checkAccess, function (req, res) {
		pile.fetchDataArea(req, res);
	});

	// get histogram from column
	app.post('/api/db/fetchHistogram', checkAccess, function (req, res) {
		pile.fetchHistogram(req, res);
	});

	// proxy tiles
	app.get('/proxy/*', checkAccess, function (req, res) {
		pile.proxyTile(req, res);
	});

	// start server
	app.listen(port);

	// debug
	console.log('PostGIS tileserver is up @ ' + port);
}


// helper fn's for auth
function checkAccess (req, res, next) {
	var access_token = req.query.access_token || req.body.access_token;

	// request wu for checking access tokens
	var verifyUrl = 'http://wu:3001/api/token/check?access_token=' + access_token;
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

// // logger
// var logger = new (winston.Logger)({

// 	transports: [

// 		// all console.log's
// 		new winston.transports.File({ 
// 			filename: config.path.log + 'pile.log',
// 			name : 'info',
// 			level : 'info',
// 			prettyPrint : true,
// 			json : true,
// 			maxsize : 10000000, // 10MB
// 			tailable : true
// 		}),
		
// 		// console.errors
// 		new winston.transports.File({
// 			filename: config.path.log + 'pile.error.log',
// 			name : 'error',
// 			level : 'error',
// 			prettyPrint : true,
// 			json : true,
// 			maxsize : 10000000, // 10MB
// 			tailable : true

// 		}),

// 		// // console
// 		// new winston.transports.Console({
// 		// 	// colorize : true
// 		// }),
// 	],
// });

// // tile logger
// var tile_logger = new (winston.Logger)({

// 	transports: [

// 		// all console.log's
// 		new winston.transports.File({ 
// 			filename: config.path.log + 'pile.tiles.log',
// 			name : 'info',
// 			level : 'info',
// 			prettyPrint : true,
// 			json : true,
// 			maxsize : 10000000, // 10MB
// 			tailable : true
// 		}),
		
// 		// // console
// 		// new winston.transports.Console({
// 		// 	// colorize : true
// 		// }),
// 	],
// });

// globally pipe console to winston
// console.log 	= logger.info;
// console.error 	= logger.error;
// console.tile 	= tile_logger.info;

// globally pipe console to winston
// console.log = function () {
// 	try {
// 		var arr = _.toArray(arguments);
// 		console.info(arr);
// 		logger.info(arr);

// 	} catch (e) {
// 		console.info('CONSOLE ERROR 1', e);
// 	}
// }
// console.error = function () {
// 	try {
// 		var arr = _.toArray(arguments);
// 		console.info(arr);
// 		logger.error(arr);
// 	} catch (e) {
// 		console.info('CONSOLE.ERROR', e);
// 	}
// }
// console.tile = function () {
// 	try {
// 		var arr = _.toArray(arguments);
// 		console.info(arr);
// 		tile_logger.info(arr);
// 	} catch (e) {
// 		console.info('CONSOLE.ERROR', e);
// 	}
// }

