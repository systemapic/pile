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
var exec = require('child_process').exec;
var pg = require('pg');
var gm = require('gm');
var sanitize = require("sanitize-filename");

// modules
var server = require('./server');
var config = require('../../config/pile-config');
var store  = require('./store');
var proxy = require('./proxy');
var tools = require('./tools');

// mercator
var mercator = require('./sphericalmercator');
var geojsonArea = require('geojson-area');

// register mapnik plugions
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();

// global paths (todo: move to config)
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var GRIDPATH     = '/data/grid_tiles/';
var PROXYPATH 	 = '/data/proxy_tiles/';

var pgsql_options = {
	dbhost: 'postgis',
	dbuser: process.env.SYSTEMAPIC_PGSQL_USERNAME || 'docker',
	dbpass: process.env.SYSTEMAPIC_PGSQL_PASSWORD || 'docker'
};



module.exports = pile = { 

	config : config,

	headers : {
		jpeg : 'image/jpeg',
		png : 'image/png',
		pbf : 'application/x-protobuf',
		grid : 'application/json'
	},
	proxyProviders : ['google', 'norkart'],

	getTile : function (req, res) {

		// pipe to postgis or proxy
		if (tools.tileIsProxy(req))   return pile.serveProxyTile(req, res);
		if (tools.tileIsPostgis(req)) return pile.serveTile(req, res);

		// tile is neither proxy or postgis formatted
		// todo: error handling
		res.end(); 
	},

	serveTile : function (req, res) {

		// parse url into layerUuid, zxy, type
		var parsed = req._parsedUrl.pathname.split('/');
		var params = {
			layerUuid : parsed[3],
			z : parseInt(parsed[4]),
			x : parseInt(parsed[5]),
			y : parseInt(parsed[6].split('.')[0]),
			type : parsed[6].split('.')[1],
		};
		var map;
		var layer;
		var postgis;
		var bbox;
		var type = params.type;
		var start_time = new Date().getTime();
		var ops = [];


		// add access token to params
		params.access_token = req.query.access_token || req.body.access_token;

		// get stored layer from redis
		store.layers.get(params.layerUuid, function (err, storedLayerJSON) {	
			if (err) return pile.tileError(res, err);
			if (!storedLayerJSON) return pile.tileError(res, 'No stored layer.');

			// parse layer JSON
			var storedLayer = tools.safeParse(storedLayerJSON);

			// get tiles
			if (type == 'pbf') ops.push(function (callback) {
				pile.getVectorTile(params, storedLayer, callback);
			});

			if (type == 'png') ops.push(function (callback) {
				pile.getRasterTile(params, storedLayer, callback);
			});

			if (type == 'grid') ops.push(function (callback) {
				pile.getGridTile(params, storedLayer, callback);
			});


			// run ops
			async.series(ops, function (err, data) {

				if (err) {
					console.error({
						err_id : 2,
						err_msg : 'render vector',
						error : err,
						stack : err.stack
					});

					// return png for raster-tile requests
					if (type == 'png') return pile.serveEmptyTile(res);
					
					// return empty
					return res.json({});
				}

				// timer
				var end_time = new Date().getTime();
				var create_tile_time = end_time - start_time;

				// log tile request
				console.tile({
					z : params.z,
					x : params.x,
					y : params.y,
					format : type,
					layer_id : params.layerUuid,
					render_time : create_tile_time
				});

				// return tile to client
				res.writeHead(200, {'Content-Type': pile.headers[type]});
				res.end(data[0]);
			});
		});
		
	},


	serveProxyTile : function (req, res) {

		// parse url, set options
		var params = req.params[0].split('/');
		var options = {
			provider : params[0],
			type 	 : params[1],
			z 	 : params[2],
			x 	 : params[3],
			y 	 : params[4].split('.')[0],
			format 	 : params[4].split('.')[1]
		}

		// create proxy tile job
		var job = jobs.create('proxy_tile', { 
			options : options,
		}).priority('high').attempts(5).save();

		// proxy tile job done
		job.on('complete', function (result) {

			// serve proxy tile
			proxy.serveTile(res, options);
		});
	},

	fetchData : function (req, res) {

		var options 	= req.body;
		var column 	= options.column; // gid
		var row 	= options.row; // eg. 282844
		var layer_id 	= options.layer_id;
		var ops 	= [];

		ops.push(function (callback) {

			// retrieve layer and return it to client
			store.layers.get(layer_id, function (err, layer) {
				if (err || !layer) return callback(err || 'no layer');
				callback(null, tools.safeParse(layer));
			});
		});

		ops.push(function (layer, callback) {

			var table = layer.options.table_name;
			var database = layer.options.database_name;

			// do sql query on postgis
			var GET_DATA_SCRIPT_PATH = 'src/get_data_by_column.sh';

			// st_extent script 
			var command = [
				GET_DATA_SCRIPT_PATH, 	// script
				layer.options.database_name, 	// database name
				layer.options.table_name,	// table name
				column,
				row
			].join(' ');

			// create database in postgis
			exec(command, {maxBuffer: 1024 * 1024 * 1000}, function (err, stdout, stdin) {
				if (err) return callback(err);

				// parse results
				var json = stdout.split('\n')[2];
				var data = tools.safeParse(json);
				
				// remove geom columns
				data.geom = null;
				data.the_geom_3857 = null;
				data.the_geom_4326 = null;

				// callback
				callback(null, data);
			});
		});

		async.waterfall(ops, function (err, data) {
			if (err) console.error({
				err_id : 51,
				err_msg : 'fetch data script',
				error : err
			});
			res.json(data);
		});

	},

	fetchDataArea : function (req, res) {
		var options = req.body,
		    geojson = options.geojson,
		    access_token = options.access_token,
		    layer_id = options.layer_id;

		var ops = [];

		// error handling
		if (!geojson) return pile.error.missingInformation(res, 'Please provide an area.')

		ops.push(function (callback) {
			// retrieve layer and return it to client
			store.layers.get(layer_id, function (err, layer) {
				if (err || !layer) return callback(err || 'no layer');
				callback(null, tools.safeParse(layer));
			});
		});

		ops.push(function (layer, callback) {
			var table = layer.options.table_name;
			var database = layer.options.database_name;
			var polygon = "'" + JSON.stringify(geojson.geometry) + "'";
			var sql = '"' + layer.options.sql + '"';

			// do sql query on postgis
			var GET_DATA_AREA_SCRIPT_PATH = 'src/get_data_by_area.sh';

			// st_extent script 
			var command = [
				GET_DATA_AREA_SCRIPT_PATH, 	// script
				layer.options.database_name, 	// database name
				sql,
				polygon
			].join(' ');

			// do postgis script
			exec(command, {maxBuffer: 1024 * 50000}, function (err, stdout, stdin) {
				if (err) return callback(err);

				var arr = stdout.split('\n');
				var result = [];
				var points = [];

				arr.forEach(function (arrr) {
					var item = tools.safeParse(arrr);
					item && result.push(item);
				});

				result.forEach(function (point) {

					// delete geoms
					delete point.geom;
					delete point.the_geom_3857;
					delete point.the_geom_4326;
					
					// push
					points.push(point);
				});

				// calculate averages, totals
				var average = tools._calculateAverages(points);
				var total_points = points.length;

				// only return 100 points
				if (points.length > 100) {
					points = points.slice(0, 100);
				}

				// return results
				var resultObject = {
					all : points,
					average : average,
					total_points : total_points,
					area : geojsonArea.geometry(geojson.geometry),
					layer_id : layer_id
				}

				// callback
				callback(null, resultObject);
			});
		});

		async.waterfall(ops, function (err, data) {
			if (err) console.error({
				err_id : 52,
				err_msg : 'fetch data area script',
				error : err
			});
			res.json(data);
		});
	},


	fetchHistogram : function (req, res) {
		var options = req.body;
		var column = options.column;
		var access_token = options.access_token;
		var layer_id = options.layer_id;
		var num_buckets = options.num_buckets || 20;
		var ops = [];

		ops.push(function (callback) {
			// retrieve layer and return it to client
			store.layers.get(layer_id, function (err, layer) {
				if (err || !layer) return callback(err || 'no layer');
				callback(null, tools.safeParse(layer));
			});
		});

		ops.push(function (layer, callback) {
			var table = layer.options.table_name;
			var database = layer.options.database_name;

			// do sql query on postgis
			var GET_HISTOGRAM_SCRIPT = 'src/get_histogram.sh';

			// st_extent script 
			var command = [
				GET_HISTOGRAM_SCRIPT, 	// script
				database, 	// database name
				table,
				column,
				num_buckets
			].join(' ');


			// do postgis script
			exec(command, {maxBuffer: 1024 * 50000}, function (err, stdout, stdin) {
				if (err) return callback(err);

				var arr = stdout.split('\n');
				var result = [];

				arr.forEach(function (arrr) {
					var item = tools.safeParse(arrr);
					item && result.push(item);
				});

				callback(null, result);
			});
		});


		async.waterfall(ops, function (err, data) {
			if (err) console.error({
				err_id : 53,
				err_msg : 'fetch histogram script',
				error : err
			});
			res.json(data);
		});

	},


	

	// this layer is only a postgis layer. a Wu Layer Model must be created by client after receiving this postgis layer
	createLayer : function (req, res) {
		var options 	= req.body;
		var file_id 	= options.file_id;
		var sql 	= options.sql;
		var cartocss 	= options.cartocss;
		var cartocss_version = options.cartocss_version;
		var geom_column = options.geom_column;
		var geom_type 	= options.geom_type;
		var raster_band = options.raster_band;
		var srid 	= options.srid;
		var affected_tables = options.affected_tables;
		var interactivity = options.interactivity;
		var attributes 	= options.attributes;
		var access_token = req.body.access_token;
		var ops = [];

		// log to file
		console.log({
			type : 'createLayer',
			options : options
		});

		// verify query
		if (!file_id) return pile.error.missingInformation(res, 'Please provide a file_id.')

		// get upload status
		ops.push(function (callback) {

			// get upload status object from wu
			pile.request.get('/v2/data/import/status', { 	// todo: write more pluggable
				file_id : file_id, 
				access_token : access_token
			}, callback);

		});


		// verify upload status
		ops.push(function (upload_status, callback) {
			if (!upload_status) return callback('No such upload_status.');

			// safe parse
			var upload_status = tools.safeParse(upload_status);

			// check that done importing to postgis
			if (!upload_status || !upload_status.upload_success) return callback('The data was not uploaded correctly. Please check your data and error messages, and try again.')

			// check that done importing to postgis
			if (!upload_status.processing_success) return callback('The data is not done processing yet. Please try again in a little while.')

			// create postgis layer for rasters and vector layers 
			if (upload_status.data_type != 'vector' && upload_status.data_type != 'raster') {
				// error
				return callback('Invalid data_type: ' +  upload_status.data_type);
			} 

			// create tileserver layer
			pile._createPostGISLayer({
				upload_status : upload_status,
				options : options
			}, callback);
		})
		

		// run ops
		async.waterfall(ops, function (err, layerObject) {
			if (err) {
				console.error({
					err_id : 30,
					err_msg : 'create layer',
					error : err,
					stack : err.stack
				});
				return res.json({error : err.toString() });
			}

			// return layer to client
			res.json(layerObject);
		});
	},

	vectorizeLayer : function (req, res) {
		return pile.vectorizeRaster({
			options : options,
			upload_status : upload_status
		}, callback);
	},

	vectorizeRaster : function (data, done) {

		// this fn was used to create vectors from raster files
		// we'll do this from postgis instead, so this is all deprecated
		console.error('DEPRECATED');
		return done('DEPRECATED!');
	},

	_primeTableWithGeometries : function (options, done) {

		var file_id = options.file_id,
		    postgis_db = options.postgis_db,
		    ops = [];

		// get geometry type
		ops.push(function (callback) {
			pile.pgquery({
				postgis_db : postgis_db,
				query : 'SELECT ST_GeometryType(geom) from "' + file_id + '" limit 1'
			}, function (err, results) {
				if (err) return callback(err);
				if (!results || !results.rows || !results.rows.length) return callback('The dataset contains no valid geodata.');
				var geometry_type = results.rows[0].st_geometrytype.split('ST_')[1];
				callback(null, geometry_type);
			})
		});

		// create geometry 3857
		ops.push(function (geometry_type, callback) {
			var column = ' the_geom_3857';
			var geometry = ' geometry(' + geometry_type + ', 3857)';
			var query = 'ALTER TABLE ' + file_id + ' ADD COLUMN' + column + geometry;

			pile.pgquery({
				postgis_db : postgis_db,
				query : query
			}, function (err, results) {
				if (err) return callback(err);
				callback(null, geometry_type);
			});
		});

		// create geometry 4326
		ops.push(function (geometry_type, callback) {
			var column = ' the_geom_4326';
			var geometry = ' geometry(' + geometry_type + ', 4326)';
			var query = 'ALTER TABLE ' + file_id + ' ADD COLUMN' + column + geometry;

			pile.pgquery({
				postgis_db : postgis_db,
				query : query
			}, function (err, results) {
				if (err) return callback(err);
				callback(err, geometry_type);
			});
		});


		// populate geometry
		ops.push(function (geometry_type, callback) {
			var query = 'ALTER TABLE ' + file_id + ' ALTER COLUMN the_geom_3857 TYPE Geometry(' + geometry_type + ', 3857) USING ST_Transform(geom, 3857)'

   			pile.pgquery({
				postgis_db : postgis_db,
				query : query
			}, function (err, results) {
				if (err) return callback(err);
				callback(err, geometry_type);
			});
		});

		// populate geometry
		ops.push(function (geometry_type, callback) {
			var query = 'ALTER TABLE ' + file_id + ' ALTER COLUMN the_geom_4326 TYPE Geometry(' + geometry_type + ', 4326) USING ST_Transform(geom, 4326)'

   			pile.pgquery({
				postgis_db : postgis_db,
				query : query
			}, function (err, results) {
				if (err) return callback(err);
				callback(err);
			});
		});


		// create index for 3857
		ops.push(function (callback) {
			var idx = file_id + '_the_geom_4326_idx';
			var query = 'CREATE INDEX ' + idx + ' ON ' + file_id + ' USING GIST(the_geom_4326)'

			pile.pgquery({
				postgis_db : postgis_db,
				query : query
			}, function (err, results) {
				if (err) return callback(err);
				callback(null);
			});
		});

		// create index for 4326
		ops.push(function (callback) {
			var idx = file_id + '_the_geom_3857_idx';
			var query = 'CREATE INDEX ' + idx + ' ON ' + file_id + ' USING GIST(the_geom_3857)'

			pile.pgquery({
				postgis_db : postgis_db,
				query : query
			}, function (err, results) {
				if (err) return callback(err);
				callback(null, 'ok');
			});
		});


		async.waterfall(ops, function (err, results) {
			done(err);
		});

	},


	pgquery : function (options, callback) {
		var postgis_db = options.postgis_db;
		var variables = options.variables;
		var query = options.query;
		var dbhost = pgsql_options.dbhost;
		var dbuser = pgsql_options.dbuser;
		var dbpass = pgsql_options.dbpass;
		var conString = 'postgres://'+dbuser+':'+dbpass+'@'+dbhost+'/' + postgis_db;

		pg.connect(conString, function(err, client, pgcb) {
			if (err) return callback(err);
			
			// do query
			client.query(query, variables, function(err, result) {
				
				// clean up after pg
				pgcb();

				// catch err
				if (err) return callback(err); 
				
				// return result
				callback(null, result);
			});
		});
	},


	_createPostGISLayer : function (opts, done) {
		var ops 	= [];
		var options 	= opts.upload_status;
		var file_id 	= opts.options.file_id;
		var sql 	= opts.options.sql;
		var cartocss 	= opts.options.cartocss;
		var cartocss_version = opts.options.cartocss_version;
		var geom_column = opts.options.geom_column;
		var geom_type 	= opts.options.geom_type;
		var raster_band = opts.options.raster_band;
		var srid 	= opts.options.srid;
		var affected_tables = opts.options.affected_tables;
		var interactivity = opts.options.interactivity;
		var attributes 	= opts.options.attributes;
		var access_token = opts.options.access_token;

		if (!sql) return done(new Error('Please provide a SQL statement.'))
		if (!cartocss) return done(new Error('Please provide CartoCSS.'))

		ops.push(function (callback) {

			// inject table name into sql
			var done_sql = sql.replace('table', options.table_name);

			// create layer object
			var layerUuid = 'layer_id-' + uuid.v4();
			var layer = { 	

				layerUuid : layerUuid,
				options : {			
					
					// required
					sql : done_sql,
					cartocss : cartocss,
					file_id : file_id, 	
					database_name : options.database_name, 
					table_name : options.table_name, 
					metadata : options.metadata,
					layer_id : layerUuid,
					data_type : options.data_type || opts.options.data_type || 'vector',

					// optional				// defaults
					cartocss_version : cartocss_version 	|| '2.0.1',
					geom_column : geom_column 		|| 'geom',
					geom_type : geom_type 			|| 'geometry',
					raster_band : raster_band 		|| 0,
					srid : srid 				|| 3857,
				}
			}

			callback(null, layer);
		});

		// get extent of file (todo: put in file object)
		ops.push(function (layer, callback) {

			var GET_EXTENT_SCRIPT_PATH = 'src/get_st_extent.sh';

			if (!layer.options.database_name) return callback(new Error("Unknown database_name in layer options"));
			if (!layer.options.table_name) return callback(new Error("Unknown table_name in layer options"));

			// st_extent script 
			var command = [
				GET_EXTENT_SCRIPT_PATH, 	    // script
				layer.options.database_name, 	// database name
				layer.options.table_name,     // table name
				layer.options.geom_column,	  // geometry column
			].join(' ');


			// create database in postgis
			exec(command, {maxBuffer: 1024 * 50000}, function (err, stdout, stdin) {

				if ( err ) {
					return callback(new Error(stdout));
				}

				// parse stdout
				try {
					var extent = stdout.split('(')[1].split(')')[0];
				} catch (e) {
					return callback(e);
				}

				// set extent
				layer.options.extent = extent;

				// callback
				callback(null, layer);
			});
		});


		// save layer to store.redis
		ops.push(function (layer, callback) {

			// save layer to store.redis
			store.layers.set(layer.layerUuid, JSON.stringify(layer), function (err) {
				if (err) console.error({
					err_id : 1,
					err_msg : 'create postgis layer',
					error : err
				});
				callback(err, layer);
			});
		});

		// layer created, return
		async.waterfall(ops, done);
	},

	_createRasterLayer : function (opts, done) {
		var ops = [];
		var options = opts.upload_status;
		var file_id = opts.options.file_id;
		var srid = opts.options.srid;
		var srid = options.srid;
		var access_token = opts.options.access_token;
		var cutColor = opts.options.cutColor || false;

		ops.push(function (callback) {

			// create layer object
			var layerUuid = 'layer_id-' + uuid.v4();
			var layer = { 	

				layerUuid : layerUuid,
				options : {			
					
					// required
					sql : false,
					cartocss : false,
					file_id : file_id, 	
					metadata : options.metadata,
					layer_id : layerUuid,
					srid : srid || 3857,
					data_type : 'raster',
					cutColor : cutColor
				}
			}

			callback(null, layer);

		});

		// save layer to store.redis
		ops.push(function (layer, callback) {

			// save layer to store.redis
			store.layers.set(layer.layerUuid, JSON.stringify(layer), function (err) {
				if (err) console.error({
					err_id : 2,
					err_msg : 'create raster',
					error : err
				});
				callback(err, layer);
			});
		});

		// layer created, return
		async.waterfall(ops, done);
	},


	// get layer from redis and return
	getLayer : function (req, res) {

		// get layerUuid
		var layerUuid = req.body.layerUuid || req.query.layerUuid;
		if (!layerUuid) return pile.error.missingInformation(res, 'Please provide layerUuid.');

		// retrieve layer and return it to client
		store.layers.get(layerUuid, function (err, layer) {
			if (err) console.error({
				err_id : 21,
				err_msg : 'render vector',
				error : err
			});
			res.end(layer);
		});
	},

	// helper for tile error handling
	tileError : function (res, err) {
		if (err) console.error({
			err_id : 60,
			err_msg : 'get tile error handler',
			error : err
		});
		res.end();
	},


	// start render_vector_tile job
	// will create VECTOR TILE (from postgis)
	createVectorTile : function (params, storedLayer, done) {

		// KUE: create raster tile
		var job = jobs.create('render_vector_tile', { // todo: cluster up with other machines, pluggable clusters
			params : params,
			storedLayer : storedLayer
		}).priority('high').attempts(5).save();

		// KUE DONE: raster created
		job.on('complete', function (result) {

			// get tile
			store._readVectorTile(params, done);
		});

	},

	// start render_raster_tile job
	// will create RASTER TILE (from postgis)
	createRasterTile : function (params, storedLayer, done) {

		// KUE: create raster tile
		var job = jobs.create('render_raster_tile', { // todo: cluster up with other machines, pluggable clusters
			params : params,
			storedLayer : storedLayer
		}).priority('high').removeOnComplete(true).attempts(5).save();

		// KUE DONE: raster created
		job.on('complete', function (result) {

			// get tile
			store._readRasterTile(params, done);
		});

		job.on('failed', function (err) {
			done(err);
		});

	},

	// start render_raster_tile job
	// will create UTF GRID TILE (from postgis)
	createGridTile : function (params, storedLayer, done) {

		// KUE: create raster tile
		var job = jobs.create('render_grid_tile', { // todo: cluster up with other machines, pluggable clusters
			params : params,
			storedLayer : storedLayer
		}).priority('high').attempts(5).save();


		// KUE DONE: raster created
		job.on('complete', function (result) {

			// get tile
			pile._getGridTileFromRedis(params, done);
		});

		job.on('failed', function (err) {
			done(err);
		});
	},

	serveErrorTile : function (res) {
		var errorTile = 'public/errorTile.png';
		fs.readFile('public/noAccessTile.png', function (err, tile) {
			res.writeHead(200, {'Content-Type': 'image/png'});
			res.end(tile);
		});
	},

	serveEmptyTile : function (res) {
		fs.readFile('public/emptyTile.png', function (err, tile) {
			res.writeHead(200, {'Content-Type': 'image/png'});
			res.end(tile);
		});
	},

	_renderVectorTile : function (params, done) {

		// prepare tile: 
		// parse url into layerUuid, zxy, type
		var ops = [];
		var map;
		var layer;
		var postgis;
		var bbox;

		// check params
		if (!params.layerUuid) 	   return done('Invalid url: Missing layerUuid.');
		if (params.z == undefined) return done('Invalid url: Missing tile coordinates. z', params.z);
		if (params.x == undefined) return done('Invalid url: Missing tile coordinates. x', params.x);
		if (params.y == undefined) return done('Invalid url: Missing tile coordinates. y', params.y);
		if (!params.type) 	   return done('Invalid url: Missing type extension.');


		// look for stored layerUuid
		ops.push(function (callback) {
			store.layers.get(params.layerUuid, callback);
		});

		// define settings, xml
		ops.push(function (storedLayer, callback) {
			if (!storedLayer) return callback('No such layerUuid.');

			var storedLayer = tools.safeParse(storedLayer);

			// default settings
			var default_postgis_settings = {
				user : pgsql_options.dbuser,
				password : pgsql_options.dbpass,
				host : pgsql_options.dbhost,
				type : 'postgis',
				geometry_field : 'the_geom_3857',
				srid : '3857'
			}

			// set bounding box
			bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

			// insert layer settings 
			var postgis_settings 			= default_postgis_settings;
			postgis_settings.dbname 		= storedLayer.options.database_name;
			postgis_settings.table 			= storedLayer.options.sql;
			postgis_settings.extent 		= storedLayer.options.extent;
			postgis_settings.geometry_field 	= storedLayer.options.geom_column;
			postgis_settings.srid 			= storedLayer.options.srid;
			postgis_settings.asynchronous_request 	= true;
			postgis_settings.max_async_connection 	= 10;
			

			// everything in spherical mercator (3857)!
			try {  	
				map = new mapnik.Map(256, 256, mercator.proj4);
				layer = new mapnik.Layer('layer', mercator.proj4);
				postgis = new mapnik.Datasource(postgis_settings);
				
			// catch errors
			} catch (e) { return callback(e.message); }

			// set buffer
			map.bufferSize = 128;

			// set extent
			map.extent = bbox; // must have extent!

			// set datasource
			layer.datasource = postgis;

			// add styles
			layer.styles = ['layer']; // style names in xml
			
			// add layer to map
			map.add_layer(layer);

			// parse xml from cartocss
			pile.cartoRenderer(storedLayer, layer, callback);

		});

		// load xml to map
		ops.push(function (xml, callback) {
			map.fromString(xml, {strict : true}, callback);
		});

		// run ops
		async.waterfall(ops, function (err, map) {

			// render vector tile:
			if (err) console.error({
				err_id : 3,
				err_msg : 'render vector',
				error : err
			});
			if (err) return done(err);

			var map_options = {
				variables : { 
					zoom : params.z // insert min_max etc 
				}
			}

			// vector
			var im = new mapnik.VectorTile(params.z, params.x, params.y);
			
			// check
			if (!im) return callback('Unsupported type.')

			// render
			map.render(im, map_options, function (err, tile) {
				if (err) console.error({
					err_id : 4,
					err_msg : 'render vector',
					error : err
				});

				store._saveVectorTile(tile, params, done);
			});
		});

	},

	_renderRasterTile : function (params, done) {

		console.log('_renderRasterTile', params);

		pile._prepareTile(params, function (err, map) {
			if (err) return done(err);
			if (!map) return done(new Error('no map 7474'));

			
			// debug write xml
			console.log('preparedTile XML: ', map.toXML());
			if (1) pile._debugXML(params.layerUuid, map.toXML());

			// map options
			var map_options = {
				variables : { 
					zoom : params.z // insert min_max etc 
				}
			}

			var map_options = {
				buffer_size : 128,
				variables : { 
					zoom : params.z // insert min_max etc 
				}
			}
			
			// raster
			var im = new mapnik.Image(256, 256);

			// render
			map.render(im, map_options, function (err, tile) {
				if (err) console.error({
					err_id : 5,
					err_msg : 'render raster',
					error : err
				});
				if (err) return done(err);

				// save png to redis
				store._saveRasterTile(tile, params, done);
			});
		});
		
	},


	_renderGridTile : function (params, done) {

		pile._prepareTile(params, function (err, map) {
			if (err) console.error({
				err_id : 61,
				err_msg : 'render grid tile',
				error : err
			});

			if (err) return done(err);
			if (!map) return done('no map 4493');

			var map_options = {
				variables : { 
					zoom : params.z // insert min_max etc 
				}
			}

			// raster
			var im = new mapnik.Grid(map.width, map.height);

			// var fields = ['gid', 'east', 'north', 'range', 'azimuth', 'vel', 'coherence', 'height', 'demerr'];
			var fields = ['gid']; // todo: this is hardcoded!, get first column instead (could be ['id'] etc)

			var map_options = {
				layer : 0,
				fields : fields,
				buffer_size : 128
			}
			
			// check
			if (!im) return callback('Unsupported type.')

			// render
			map.render(im, map_options, function (err, grid) {
				if (err) return done(err);
				if (!grid) return done('no grid 233');

				grid.encode({features : true}, function (err, utf) {
					if (err) return done(err);
					
					// save grid to redis
					var keyString = 'grid_tile:'  + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
					store.layers.set(keyString, JSON.stringify(utf), done);
				});
			});
		});
	},

	_prepareTile : function (params, done) {

		// parse url into layerUuid, zxy, type
		var ops = [];
		var map;
		var layer;
		var postgis;
		var bbox;

		// check params
		if (!params.layerUuid) 	   return done('Invalid url: Missing layerUuid.');
		if (params.z == undefined) return done('Invalid url: Missing tile coordinates. z', params.z);
		if (params.x == undefined) return done('Invalid url: Missing tile coordinates. x', params.x);
		if (params.y == undefined) return done('Invalid url: Missing tile coordinates. y', params.y);
		if (!params.type) 	   return done('Invalid url: Missing type extension.');


		// look for stored layerUuid
		ops.push(function (callback) {
			store.layers.get(params.layerUuid, callback);
		});

		// define settings, xml
		ops.push(function (storedLayerJSON, callback) {
			if (!storedLayerJSON) return callback('No such layerUuid.');

			// parse layer
			var storedLayer = tools.safeParse(storedLayerJSON);
			console.log('pile._prepareTile(), storedLayer: ', storedLayer);

			// default settings
			var default_postgis_settings = {
				user 	 : pgsql_options.dbuser,
				password : pgsql_options.dbpass,
				host 	 : pgsql_options.dbhost,
				srid 	 : '3857'
			}

			// set bounding box
			bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

			// insert layer settings 
			var postgis_settings 			= default_postgis_settings;
			postgis_settings.dbname 		= storedLayer.options.database_name;
			postgis_settings.extent 		= storedLayer.options.extent;
			postgis_settings.geometry_field 	= storedLayer.options.geom_column;
			postgis_settings.srid 			= storedLayer.options.srid;
			postgis_settings.asynchronous_request 	= true;
			postgis_settings.max_async_connection 	= 10;

			if ( storedLayer.options.data_type == 'raster' ) {
				postgis_settings.type = 'pgraster';
				postgis_settings.geometry_field = 'rast';
				postgis_settings.table 	= storedLayer.options.file_id;
			 } else {
				postgis_settings.type = 'postgis';
				postgis_settings.geometry_field = 'the_geom_3857';
				postgis_settings.table 	= storedLayer.options.sql;
			}

			// https://github.com/mapnik/node-mapnik/blob/ea012648beb476aafc747732e955027c99212c4c/src/mapnik_datasource.cpp#L72
			

			// everything in spherical mercator (3857)!
			try {  	
				map 	= new mapnik.Map(256, 256, mercator.proj4);
				layer 	= new mapnik.Layer('layer', mercator.proj4);
				postgis = new mapnik.Datasource(postgis_settings);
				
			// catch errors
			} catch (e) { return callback(e.message); }

			// set buffer
			map.bufferSize = 128;

			// set extent
			map.extent = bbox; // must have extent!

			// set datasource
			layer.datasource = postgis;

			// add styles
			layer.styles = ['layer']; // style names in xml
			
			// add layer to map
			map.add_layer(layer);

			// parse xml from cartocss
			pile.cartoRenderer(storedLayer, layer, callback);

		});

		// load xml to map
		ops.push(function (xml, callback) {
			map.fromString(xml, {strict : true}, callback);
		});

		// run ops
		async.waterfall(ops, done);

	},

	
	// return tiles from redis/disk or create
	getRasterTile : function (params, storedLayer, done) {

		// check cache
		store._readRasterTile(params, function (err, data) {

			// return data
			if (data) return done(null, data);
			
			// create
			pile.createRasterTile(params, storedLayer, done);
		});
	},

	// return tiles from redis/disk or create
	getVectorTile : function (params, storedLayer, done) {

		// check redis
		store._readVectorTile(params, function (err, data) {

			// return data
			if (data) return done(null, data);

			// create
			pile.createVectorTile(params, storedLayer, done);
		});
	},

	// return tiles from redis/disk or create
	getGridTile : function (params, storedLayer, done) {

		// check cache
		pile._getGridTileFromRedis(params, function (err, data) {

			// found, return data
			if (data) return done(null, data);

			// not found, create
			pile.createGridTile(params, storedLayer, done);
		});
	},


	// get grid tiles from redis
	_getGridTileFromRedis : function (params, done) {
		var keyString = 'grid_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		store.layers.get(keyString, done);
	},


	// convert CartoCSS to Mapnik XML
	cartoRenderer : function (storedLayer, layer, callback) {

		var css = storedLayer.options.cartocss;

		if (!css) {
			console.error( 'cartoRenderer called with undefined or empty css' );
			css = "#layer {}";
		}

		var options = {
			// srid 3857
			"srs": "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over",

			"Stylesheet": [{
				"id" : 'tile_style',
				"data" : css
			}],
			"Layer" : [layer]
		}

		try  {
			// carto renderer
			var xml = new carto.Renderer().render(options);
			callback(null, xml);

		} catch (e) {
			var err = { message : 'CartoCSS rendering failed: ' + e.toString() }
			callback(err);
		}

	},

	_debugXML : function (layer_id, xml) {
		var xml_filename = 'tmp/' + layer_id + '.debug.xml';
		fs.outputFile(xml_filename, xml, function (err) {
			if (!err) console.log('wrote xml to ', xml_filename);
		});
	},



	// todo: refactor, just use request module
	request : {

		get : function (endpoint, options, callback) {
			var baseUrl = 'http://wu:3001';
			var params = '';

			// parse options to params
			if (_.size(options)) {
				params += '?';
				var n = _.size(options);
				for (o in options) {
					params += o + '=' + options[o];
					n--;
					if (n) params += '&'
				}
			}

			// make request
			request({
				method : 'GET',
				uri : baseUrl + endpoint + params
			}, function (err, response, body) {
				callback(err, body);
			}); 
		},
	},
	
	// helper fn's for error handling
	error : {
		missingInformation : function (res, missing) {
			var error = 'Missing information'
			var error_description = missing + ' Check out the documentation on https://docs.systemapic.com.';
			res.json({
				error : error,
				error_description : error_description
			});
		},
		noAccess : function (res) {
			res.json({
				error : 'Unauthenicated.'
			});
		},
	},


	// helper fn's for auth
	checkAccess : function (req, res, next) {
		var access_token = req.query.access_token || req.body.access_token;

		// request wu for checking access tokens
		var verifyUrl = 'http://wu:3001/v2/users/token/check?access_token=' + access_token;
		request(verifyUrl, function (error, response, body) {
			if (!response) return res.json({access : 'Unauthorized'});
			
			var status = tools.safeParse(body);

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
}

// #########################################
// ###  Initialize Kue                   ###
// #########################################
// init kue
var jobs = kue.createQueue({
   	redis : config.redis.temp,
   	prefix : '_kue4'
});

// clear kue
jobs.watchStuckJobs();

// #########################################
// ###  Clusters                         ###
// #########################################

// master cluster:
if (cluster.isMaster) { 

	// start server
	server(pile);

	console.log('Cluster...' + numCPUs);
	for (var i = 0; i < numCPUs - 2; i++) {  // 6 cpus
		// fork workers
		cluster.fork(); 
	} 

	// listen to exit, keep alive
	cluster.on('exit', function(worker, code, signal) { 
		console.error({
			err_id : 7,
			err_msg : 'cluster died',
		});
		cluster.fork(); 
	});





// worker clusters
} else {

	console.log('...clustering!');

	// #########################################
	// ###  Kue jobs: Vector render          ###
	// #########################################
	// render vector job
	jobs.process('render_vector_tile', 1, function (job, done) {

		var params = job.data.params;
		pile._renderVectorTile(params, function (err) {
			if (err) console.error({
				err_id : 8,
				err_msg : 'render vector tile',
				error : err
			});
			done(err);
		});
	});

	// render raster job
	jobs.process('render_raster_tile', 3, function (job, done) {

		var params = job.data.params;

		// render
		pile._renderRasterTile(params, function (err) {
			if (err) {
				console.error({
					err_id : 9,
					err_msg : 'Error rendering raster tile',
					error : err
				});

				return done(err);
			}
			done(null);
		});

	});

	// render grid job
	jobs.process('render_grid_tile', 1, function (job, done) {

		var params = job.data.params;
		pile._renderGridTile(params, function (err) {
			if (err) console.error({
				err_id : 10,
				err_msg : 'Error rendering grid tile',
				error : err
			});
			done(err);
		});
	});


	// proxy tiles
	jobs.process('proxy_tile', 100, function (job, done) {

		var options = job.data.options;
		proxy.serveTile(options, function (err) {
			if (err) console.error({
				err_id : 11,
				err_msg : 'proxy tile job',
				error : err
			});
			done();
		});
	});

	// remove stale jobs
	jobs.on('job complete', function (id) {
		kue.Job.get(id, function (err, job) {
			if (err) return;

			var params = job.data.params;
			var job_id = job.id;

			job.remove(function (err) {
				if (err) console.error({
					err_id : 13,
					err_msg : 'job remove',
					error : err
				});
			});
		});
	});

}
