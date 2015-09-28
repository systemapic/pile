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

module.exports = proxy = { 

	headers : {
		jpeg : 'image/jpeg',
		png : 'image/png',
		pbf : 'application/x-protobuf',
		grid : 'application/json'
	},

	serveTile : function (res, options) {

		// tile path on disk
		var tile_on_disk_path = PROXYPATH + options.provider + '/' + options.type + '/' + options.z + '/' + options.x + '/' + options.y + '.' + options.format;

		// read tile, serve
		fs.readFile(tile_on_disk_path, function (err, buffer) {
			if (err) console.log('err: ', err);

			// error tile
			if (err) return proxy._serveErrorTile(res);

			// send tile to client
			res.writeHead(200, {'Content-Type': pile.headers[options.format]}); 
			res.end(buffer);
		});

	},

	_serveErrorTile : function (res) {
		var errorTile = 'public/errorTile.png';
		fs.readFile('public/noAccessTile.png', function (err, tile) {
			res.writeHead(200, {'Content-Type': 'image/png'});
			res.end(tile);
		});
	},

	_getTile : function (options, done) {

		// provider
		var provider = options.provider;

		// pass to provider
		if (provider == 'norkart') return proxy._getNorkartTile(options, done);
		if (provider == 'google') return proxy._getGoogleTile(options, done);

		// provider not supported err
		var err = 'Provider not supported!', provider
		console.log(err);
		done(err);
	},

	_fetchTile : function (options, done) {

		// check disk first
		var tile_on_disk_folder = PROXYPATH + options.provider + '/' + options.type + '/' + options.z + '/' + options.x + '/' 
		var tile_on_disk_path = tile_on_disk_folder + options.y + '.' + options.format;

		// url, headers
		var url = options.url;
		var headers = options.headers;

		var ops = [];

		console.log('_fetchTile:');
		console.log(tile_on_disk_path);
		console.log(url);

		// check disk
		ops.push(function (callback) {

			fs.readFile(tile_on_disk_path, function (err, data) {
				
				// found tile on disk
				if (!err && data) return callback({
					status : 'got tile!'
				});

				// didnt find, do next
				callback(null);
			});
		});

		// get tile from http
		ops.push(function (callback) {

			// create folder
			fs.ensureDir(tile_on_disk_folder, function (err) {
				if (err) console.log('err', err);
			
				var httpOptions = {
					url: url,
					timeout : '10000',
					headers : headers
				};

				console.log('getting tile from internet');
				
				// get tile
				http.get(httpOptions, tile_on_disk_path, function (err, result) {
					if (err) console.log('http.get err:', err);
					
					// got tile
					if (!err && result) return callback({
						status : 'got tile!'
					});

					// didn't get tile, something wrong					
					callback({
						error: 'Could not get tile from disk nor http.'
					});
				});
			});
		});
		
		// run ops
		async.series(ops, function (err) {

			// some error
			if (err.error) return done(err.error);

			// done here
			done();
		});
	},

	_getGoogleTile : function (options, done) {

		// url schemes
		var google_types = {
			vector: "http://mt0.google.com/vt/",
			aerial: "https://khms1.googleapis.com/kh?v=182&hl=en-US&",
		}

		// google url
		var url = google_types[options.type] + 'x=' + options.x + '&y=' + options.y + '&z=' + options.z;

		// set url, headers
		options.url = url;
		options.headers = {
			'User-Agent' : 'Systemapic Tile Proxy',
			'Referer' : 'https://dev.systemapic.com/',
			'X-Message-For-Google' : 'Hi Google! This is perhaps in violation of TOS. However, we are a young Norwegian startup without revenue. We cannot use your JS api, it breaks our Leaflet.js based platform. We will fix this asap, but in the meantime I hope you wont mind us too much. We are working hard to become your paying customers! Have a great day! Sincerely Yours, knutole@systemapic.com',
			'X-Google-Server-API-Key' : 'AIzaSyA-aG1H1KYHOYE-as-dxIqqSLr1RJZJs-g'
		}

		// fetch
		proxy._fetchTile(options, done);
	},
	

	_getNorkartTile : function (options, done) {

		// url schemes
		var norkart_types = {
			vector: "webatlas-standard-vektor",
			aerial: "webatlas-orto-newup",
			hybrid: "webatlas-standard-hybrid"
		}

		var url = 'https://www.webatlas.no/maptiles/tiles/' + norkart_types[options.type] + '/wa_grid/' + options.z + '/' + options.x + '/' + options.y + '.' + options.format;

		// var bbox = this._getNorkartBBOX(options);
		// var url ='http://www.webatlas.no/wms-orto/hist1881/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=Saltfjellet-2014&STYLES=&FORMAT=image%2Fjpeg&TRANSPARENT=false&HEIGHT=256&WIDTH=256&DETECTRETINA=true&SRS=EPSG%3A3857&BBOX=1591724.6770105103,9931921.707262663,1592336.1732367915,9932533.203488942'
		// var url ='http://www.webatlas.no/wms-orto/hist1881/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=Saltfjellet-2014&STYLES=&FORMAT=image%2Fjpeg&TRANSPARENT=false&HEIGHT=256&WIDTH=256&DETECTRETINA=true&SRS=EPSG%3A3857&BBOX=1592336.1732367915,9928252.72990497,1594782.158141917,9930698.714810098'
		// set url, headers
		options.url = url;
		options.headers = {
			'User-Agent' : 'Systemapic Tile Proxy',
			'Referer' : 'https://dev.systemapic.com/',
			'X-Message-For-Norkart' : 'We are proxying because we need four subdomains for speedy tile requests. Logging is done as normal in browser! – knutole@systemapic.com'
		}

		// fetch
		proxy._fetchTile(options, done);

	},

	// _getNorkartBBOX : function (options) {
		
	// 	var z = options.z,
	// 	    x = options.x,
	// 	    y = options.y;

	// 	var lng = this._tile2lng(x, z);
	// 	console.log('lng: ', lng);

	// 	var lat = this._tile2lat(y, z);
	// 	console.log('lat: ', lat); 

	// 	// var bbox = this._getbbox([lat, lng]);
	// 	console.log('converter: ', converter);

	// 	console.log('fN: ', fn);
	// 	var fn = converter('latlong', 'utm');
	// 	var bbox = fn(lat, lng, z);

	// 	console.log('bbox: :: : ', bbox);
	// },

	// _getbbox : function (latlng) {
	// 	var map = this._map,
	// 	    crs = map.options.crs,
	// 	    tileSize = this.options.tileSize,

	// 	    nwPoint = tilePoint.multiplyBy(tileSize),
	// 	    sePoint = nwPoint.add([tileSize, tileSize]),

	// 	    nw = crs.project(map.unproject(nwPoint, zoom)),
	// 	    se = crs.project(map.unproject(sePoint, zoom)),

	// 	    bbox = [nw.x, se.y, se.x, nw.y].join(','),
	// },

	_tile2lng : function (x,z) {
		return (x/Math.pow(2,z)*360-180);
	},

	_tile2lat : function (y,z) {
		var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
		return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
	},


	_getHistoricalNorkartTile : function (options, done) {





	}
}
















