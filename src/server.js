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
var request 	= require('request');
var winston 	= require('winston');

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
	app.post('/v2/tiles/create', pile.checkAccess, function (req, res) {
		pile.createLayer(req, res);
	});

	// create cube layer
	app.post('/v2/cubes/create', pile.checkAccess, function (req, res) {
		pile.cubes.create(req, res);
	});

	// add dataset to cube
	app.post('/v2/cubes/add', pile.checkAccess, function (req, res) {
		pile.cubes.add(req, res);
	});

	// remove dataset from cube
	app.post('/v2/cubes/remove', pile.checkAccess, function (req, res) {
		pile.cubes.remove(req, res);
	});

	// update dataset
	app.post('/v2/cubes/update', pile.checkAccess, function (req, res) {
		pile.cubes.update(req, res);
	});

	// request cube tiles
	app.get('/v2/cubes/get', pile.checkAccess, function (req, res) {
		pile.cubes.get(req, res);
	});

	// create cube layer
	app.get('/v2/cubes/*', pile.checkAccess, function (req, res) {
		pile.cubes.tile(req, res);
	});

	// vectorize layer
	app.post('/v2/tiles/vectorize', pile.checkAccess, function (req, res) {
		pile.vectorizeDataset(req, res);
	});

	// update layer
	app.post('/v2/tiles/update', pile.checkAccess, function (req, res) {
		pile.updateLayer(req, res);
	});

	// get layer
	app.get('/v2/tiles/layer', pile.checkAccess, function (req, res) {
		pile.getLayer(req, res);
	});

	// get tiles
	app.get('/v2/tiles/*', pile.checkAccess, function (req, res) {
		pile.getTileEntryPoint(req, res);
	});

	// get data from point
	app.post('/v2/query/point', pile.checkAccess, function (req, res) {
		pile.fetchData(req, res);
	});

	// get data from area
	app.post('/v2/query/polygon', pile.checkAccess, function (req, res) {
		pile.fetchDataArea(req, res);
	});

	// get histogram from column
	app.post('/v2/query/histogram', pile.checkAccess, function (req, res) {
		pile.fetchHistogram(req, res);
	});

	// start server
	app.listen(pile.config.port);

	// debug
	console.log('PostGIS tileserver is up @ ' + pile.config.port);
}


// tile render logging
console.tile = function (tile) {
	if (tile.render_time) console.info('rendered tile in ', tile.render_time, 'ms');
};
