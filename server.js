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


	// create layer
	app.post('/api/db/createLayer', checkAccess, function (req, res) {
		console.log('route: api/db/createLayer');
		pile.createLayer(req, res);
	});

	// update layer
	app.post('/api/db/updateLayer', checkAccess, function (req, res) {
		console.log('route: api/db/createLayer');
		pile.updateLayer(req, res);
	});

	// get layer
	app.get('/api/db/getLayer', checkAccess, function (req, res) {
		console.log('route: api/db/getLayer');
		pile.getLayer(req, res);
	});

	// get raster tile
	app.get('/api/db/raster', checkAccess, function (req, res) {
		console.log('server.js GET /api/db/raster');
		pile.getRasterTile(req, res);
	});

	// get tiles
	app.get('/tiles/*', checkAccess, function (req, res) {
		console.log('route /api/tiles/*');
		pile.getTile(req, res);
	});








	// start server
	app.listen(port);

	// debug
	console.log('PostGIS tileserver is up @ ', port);
}


// helper fn's for auth
function checkAccess (req, res, next) {
	console.time('checkAccess');
	var access_token = req.query.access_token || req.body.access_token;

	// request wu for checking access tokens
	var verifyUrl = 'http://wu:3001/api/token/check?access_token=' + access_token;
	request(verifyUrl, function (error, response, body) {
	console.timeEnd('checkAccess');
		
		// allowed
		if (response.statusCode == 200 && !error && body == 'OK') return next();

		// not allowed
		res.json({access : 'Unauthorized'});
	});
}
