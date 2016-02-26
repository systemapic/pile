// dependencies
var _ = require('lodash');
var fs = require('fs-extra');
var kue = require('kue');
var path = require('path');
var zlib = require('zlib');
var uuid = require('uuid');
var async = require('async');
var redis = require('redis');
var carto = require('carto');
var mapnik = require('mapnik');
var colors = require('colors');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var mongoose = require('mongoose');
var request = require('request');
var http = require('http-request');

// var converter = require('../test/node-coordinator/coordinator');

// global paths
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var GRIDPATH     = '/data/grid_tiles/';
var PROXYPATH 	 = '/data/proxy_tiles/';

// config
var config = require('../config/pile-config');

var pile_settings = {
	store : 'disk' // or redis
}

module.exports = tools = { 

	tileIsProxy : function (req) {
		var params = req.params[0].split('/');
		var provider = params[0];
		var isProxy = _.contains(pile.proxyProviders, provider);
		return isProxy;
	},

	tileIsPostgis : function (req) {
		var params = req.params[0].split('/');
		var layer_id = params[0];
		var isPostgis = _.contains(layer_id, 'layer_id-');
		return isPostgis;
	},

	_calculateAverages : function (points) {

		var keys = {};

		// get keys
		for (var key in points[0]) {
			keys[key] = [];
		}

		// sum values
		points.forEach(function (p) {
			for (var key in p) {
				keys[key].push(p[key]);
			}
		});

		// calc avg
		var averages = {};
		for (var k in keys) {
			averages[k] = (_.sum(keys[k]) / keys[k].length)
		}

		return averages;
	},

	safeParse : function (string) {
		try {
			var o = JSON.parse(string);
			return o;
		} catch (e) {
			console.log('JSON.parse error of string:', string, e);
			return false;
		}
	},



	// deprecated, but keeping for now
	_cutWhite : function (options, callback) {
		var path = options.path;
		var originalPath = options.originalPath;
		var returnBuffer = options.returnBuffer;

		gm(originalPath)
		.whiteThreshold(200, 200, 200, 1)
		.transparent('#FFFFFF')
		.write(path, function (err) {
			if (!err && returnBuffer) {
				fs.readFile(path, callback);
			} else {
				callback(err);
			}
		});

	},
	_cutBlack : function (options, callback) {
		var path = options.path;
		var originalPath = options.originalPath;
		var returnBuffer = options.returnBuffer;

		gm(originalPath)
		.blackThreshold(20, 20, 20, 1)
		.transparent('#000000')
		.write(path, function (err) {
			if (!err && returnBuffer) {
				fs.readFile(path, callback);
			} else {
				callback(err);
			}
		});
	},

	cutColor : function (options, callback) {
		var path = options.path;
		var originalPath = options.originalPath;
		var color = options.color;
		var returnBuffer = options.returnBuffer;

		gm(originalPath)
		.whiteThreshold(220, 220, 220, 1)
		.transparent('#FFFFFF')
		.write(path, function (err) {

			if (!err && returnBuffer) {
				fs.readFile(path, callback);
			} else {
				callback(err);
			}
		});
	},

	getRandomChars : function (len, charSet) {
		charSet = charSet || 'abcdefghijklmnopqrstuvwxyz';
		var randomString = '';
		for (var i = 0; i < len; i++) {
			var randomPoz = Math.floor(Math.random() * charSet.length);
			randomString += charSet.substring(randomPoz,randomPoz+1);
		}
		return randomString;
	},

	checkParams : function (params, done) {
		if (!params.layerUuid) 		return done('Invalid url: Missing layerUuid.');
		if (params.z == undefined) 	return done('Invalid url: Missing tile coordinates. z', params.z);
		if (params.x == undefined) 	return done('Invalid url: Missing tile coordinates. x', params.x);
		if (params.y == undefined) 	return done('Invalid url: Missing tile coordinates. y', params.y);
		if (!params.type) 		return done('Invalid url: Missing type extension.');
		return done(null);
	},

	_checkTileIntersect : function (bbox, extentString) {

		var extent = [
			parseFloat(extentString.split(' ')[0]),
			parseFloat(extentString.split(' ')[1].split(',')[0]),
			parseFloat(extentString.split(',')[1].split(' ')[0]),
			parseFloat(extentString.split(',')[1].split(' ')[1]),
		]

		return pile._intersects(bbox, extent);
	},


	_intersects : function (box1, box2) {
		// return true if boxes intersect, quick n dirty

		// tile
		var box1_xmin = box1[0]
		var box1_ymin = box1[1]
		var box1_xmax = box1[2]
		var box1_ymax = box1[3]

		// data
		var box2_xmin = box2[0]
		var box2_ymin = box2[1]
		var box2_xmax = box2[2]
		var box2_ymax = box2[3]

		// if both sides of tile is further north than extent, no overlap possible
		if (box1_ymax > box2_ymax && box1_ymin > box2_ymax) return false;

		// if both sides of tile is further west than extent, no overlap possible
		if (box1_xmin < box2_xmin && box1_xmax < box2_xmin) return false;

		// if both sides of tile is further south than extent, no overlap possible
		if (box1_ymin < box2_ymin && box1_ymax < box2_ymin) return false;

		// if both sides of tile is further east than extent, no overlap possible
		if (box1_xmax > box2_xmax && box1_xmin > box2_xmax) return false;

		return true;
	},

}