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
var config 	= require('./config/pile-config'); // config
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


	// import geojson
	app.get('/api/data/export/test', checkAccess, function (req, res) {
		pile.test(req, res);
	});


	app.get('/api/data/file', checkAccess, function (req, res) {

		// pile.

	});

	// // import cartocss
	// app.post('/import/cartocss', function (req, res) {
	// 	vile.importCartoCSS(req, res);
	// });

	// // request tiles
	// app.get('/r/*', hasToken, function(req, res) {								// todo: checks. security.
	// 	vile.requestRasterTile(req, res);
	// });

	// // request tiles
	// app.get('/v/*', hasToken, function(req, res) {								// todo: checks. security.
	// 	vile.requestVectorTile(req, res);
	// });

	// // request utfgrid tiles
	// app.get('/u/*', hasToken, function(req, res) {								// todo: checks. security.
	// 	vile.requestUTFGrid(req, res);
	// });

	// revv
	app.listen(port);

	console.log('PostGIS tileserver is up @ ', port);



}



// #########################################
// ###  Redis for Tile Auth Tokens       ###
// #########################################
// configure redis for token auth
var redis = require('redis');
var r = redis.createClient(config.tokenRedis.port, config.tokenRedis.host)
r.auth(config.tokenRedis.auth);
r.on('error', function (err) { console.error(err); });



// #########################################
// ###  Helper fn's for auth             ###
// #########################################
function checkAccess (req, res, next) {
	console.time('checkAccess');
	var access_token = req.query.access_token || req.body.access_token;

	// do request to wu for checking access tokens
	var verifyUrl = 'http://wu:3001/api/token/check?access_token=' + access_token;
	request(verifyUrl, function (error, response, body) {
		console.timeEnd('checkAccess');
		
		// allowed
		if (response.statusCode == 200 && !error && body == 'OK') return next();

		// not allowed
		res.json({access : 'Unauthorized'});
	});
}




















// helper function: if has token
function hasToken(req, res, next) {

	// grid or png
	var grid = req.route.path == '/u/*';

	// get token	
	var token = req.query.token;

	// no token, no access
	if (!token) return noAccess({
		res : res,
		grid : grid,
		token : token
	});

	// get tokens
	try { 
		var storedKey, accessToken, arr;
		arr = token.split('.');
		storedKey = arr[0];

	} catch (e) { 
		console.log('token err e:', e);
		// err
		return noAccess({
			res : res,
			grid : grid,
			token : token,
			e : e,
			storedKey : storedKey,
			token : token
		}); 
	}

	// check redis store
	r.get(storedKey, function (err, value) {

		// err, no access
		if (err) {
			console.log('token err: ', err);
			return noAccess({
				res : res,
				grid : grid,
				token : token,
				storedKey : storedKey,
				value : value,
				token : token
			});
		}
		
		// console.log('token: ', token);
		// console.log('value: ', value);

		// if access, next()
		if (value == token) return next();
		
		// no access
		return noAccess({
			res : res,
			grid : grid,
			token : token,
			storedKey : storedKey,
			value : value
		});

	});
}
// helper fn: no access return
function noAccess(options) {
	var grid = options.grid,
	    res = options.res;

	// for debug output
	var info = _.clone(options);
	delete info.res;

	if (grid) {
		console.log('noAccess (grid)'.yellow, info);
		res.set('Content-Type', 'application/json');
		res.end(JSON.stringify({ error : config.noAccessMessage }));
		return;
	} else {
		console.log('noAccess (raster)'.red, info);
		fs.readFile(config.noAccessTile, function (err, data) {
			res.set({'Content-Type' : 'image/png'});
			res.send(data);	
			res.end();
		});
	}
}