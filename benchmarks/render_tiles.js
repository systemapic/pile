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

// global paths
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var GRIDPATH     = '/data/grid_tiles/';

// config

var subdomains = [
	'gs-tiles-a',
	'gs-tiles-b',
	'gs-tiles-c',
	'gs-tiles-d'
]

// make requests for tiles
// var layer_id = 'layer_id-8645084a-a737-4bde-bba7-663c8dd022c1'; // snowcaps, 1gb, turkey

var layer_id = 'layer_id-29680d88-446b-450a-88ef-6ad2160f1461' // sql where height > 1500

var access_token = '492UxJtf4xXmmsIy2hiwQKn5Nb0eBuhUNPyU4P2lIasYEOmT2vnXaYBigH364DoCoyrEJp3MEOEqDSbYQCrxqNxR34ld88CIR381u6HqX2dy47cqhEbFcOEVf6fPrD3UvRWY4vswHSte8RsVT58yXMh2Zz27hJaB3CDveOYo1PStqKIMgku4H8GIzeoB4K0S3v2c5ezKY1wmdxV3l4NNwCl4bzdkEs0DNOgbU1HAC2YhibEAMC4OA399yhGsCr6q';

// which tiles

// var tiles = [
// 	'/13/5064/3160',
// 	'/13/5064/3161',
// 	'/13/5063/3160',
// 	'/13/5065/3160',
// 	'/13/5063/3161',
// 	'/13/5065/3161',
// 	'/13/5064/3162',
// 	'/13/5064/3159',
// 	'/13/5063/3159',
// 	'/13/5065/3159',
// 	'/13/5063/3162',
// 	'/13/5065/3162',
// 	'/13/5066/3161',
// 	'/13/5066/3160',
// 	'/13/5062/3160',
// 	'/13/5062/3161',
// 	'/13/5062/3159',
// 	'/13/5066/3159',
// 	'/13/5062/3162',
// 	'/13/5066/3162'
// ]

var tiles = [
	'/14/10128/6321',
	'/14/10128/6322',
	'/14/10127/6321',
	'/14/10129/6321',
	'/14/10127/6322',
	'/14/10129/6320',
	'/14/10128/6320',
	'/14/10128/6323',
	'/14/10129/6322',
	'/14/10127/6320',
	'/14/10127/6323',
	'/14/10129/6323',
	'/14/10130/6322',
	'/14/10130/6321',
	'/14/10126/6321',
	'/14/10126/6322',
	'/14/10126/6320',
	'/14/10130/6320',
	'/14/10126/6323',
	'/14/10130/6323'


]

var prefix = 'https://';
var baseurl = '.systemapic.com/tiles/';
var suffix = '.png?';
var access_token_string = 'access_token=' + access_token;
var urls = []

var n = 0;

tiles.forEach(function (tile) {

	// var subdomain = subdomains[_.random(3)];

	var subdomain = subdomains[n];

	n += 1;

	if (n==4) n = 0;

	var url_string = prefix + subdomain + baseurl + layer_id + tile + suffix + access_token_string;

	urls.push({
		url : url_string,
		tile : tile
	});
});

var ops = []

urls.forEach(function (u) {

	// make request for each tile
	ops.push(function (callback) {

		console.log('requesting', u.tile);

		console.time('got tile')
		request(u.url, function (err, response, body) {
			
			if (err) console.log('request err: ', err);

			if (!err && response.statusCode == 200){
				console.timeEnd('got tile')
			}
		
			callback(err);

		});


	})

});

console.time('benchmark time');
async.parallel(ops, function (err, results) {
	console.log('parallel done!', err);
	console.log('\n');
	console.log('------ benchmark --------');
	console.log('Requested ' + tiles.length + ' tiles');
	console.timeEnd('benchmark time');
});












