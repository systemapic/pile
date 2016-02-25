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
var config = require('../config/pile-config');
var store  = require('./store');
var proxy = require('./proxy');

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

	headers : {
		jpeg : 'image/jpeg',
		png : 'image/png',
		pbf : 'application/x-protobuf',
		grid : 'application/json'
	},
	proxyProviders : ['google', 'norkart'],

	getTile : function (req, res) {
		if (pile.tileIsProxy(req)) return pile.serveProxyTile(req, res);
		if (pile.tileIsPostgis(req)) return pile.serveTile(req, res);
		res.end(); // todo: error handling
	},

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

	serveTile : function (req, res) {

		// parse url into layerUuid, zxy, type
		// var ops = [];
		// var parsed = req._parsedUrl.pathname.split('/');
		// var params = {
		// 	layerUuid : parsed[3],
		// 	z : parseInt(parsed[4]),
		// 	x : parseInt(parsed[5]),
		// 	y : parseInt(parsed[6].split('.')[0]),
		// 	type : parsed[6].split('.')[1],
		// };
		
		return pile._getTile(req, res);
	},

	_getTile : function (req, res) {

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
		var ops = [];
		var start_time = new Date().getTime();


		// add access token to params
		params.access_token = req.query.access_token || req.body.access_token;

		// get stored layer
		store.layers.get(params.layerUuid, function (err, storedLayerJSON) {	
			if (err) return pile._getTileErrorHandler(res, err);
			if (!storedLayerJSON) return pile._getTileErrorHandler(res, 'No stored layer.');

			var storedLayer = JSON.parse(storedLayerJSON);

			console.log('pile._getTile(), storedLayer: ', storedLayer);


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



	// todo: REFACTOR with proper postgis raster instead
	getOverlayTile : function (req, res) {

		// parse url into layerUuid, zxy, type
		var ops = [],
		    parsed = req._parsedUrl.pathname.split('/'), 
		    params = {
			layerUuid : parsed[3],
			z : parseInt(parsed[4]),
			x : parseInt(parsed[5]),
			y : parseInt(parsed[6].split('.')[0]),
			type : parsed[6].split('.')[1],
		    };

		var map,
		    layer,
		    postgis,
		    bbox;
		var type = params.type;
		var ops = [];

		console.log('overlaye params', params);

		// get stored layer
		store.layers.get(params.layerUuid, function (err, storedLayerJSON) {	
			if (err) return pile._getTileErrorHandler(res, err);
			if (!storedLayerJSON) return pile._getTileErrorHandler(res, 'No stored layer.');

			var storedLayer = JSON.parse(storedLayerJSON);
			var cutColor = storedLayer.options.cutColor;

			if (cutColor) {

				var colorName = sanitize(cutColor);

				// get file etc.
				var file_id = storedLayer.options.file_id;
				var originalPath = '/data/raster_tiles/' + file_id + '/raster/' + params.z + '/' + params.x + '/' + params.y + '.png';
				var path = originalPath + '.cut-' + colorName;
				fs.readFile(path, function (err, buffer) {

					// not created yet, do it!
					if (err || !buffer) {

						// cut white; todo: all colors (with threshold)
						if (colorName == 'white') {

							pile._cutWhite({
								path : path,
								originalPath : originalPath,
								returnBuffer : true
							}, function (err, buffer) {
								// send to client
								res.writeHead(200, {'Content-Type': pile.headers[type]});
								res.end(buffer);
							});

						// cut black: todo: https://github.com/systemapic/wu/issues/256
						} else if (colorName == 'black') {

							pile._cutBlack({
								path : path,
								originalPath : originalPath,
								returnBuffer : true
							}, function (err, buffer) {
								// send to client
								res.writeHead(200, {'Content-Type': pile.headers[type]});
								res.end(buffer);
							});

						// no cut
						} else {
							console.log('no cut raster! probably something wrong...')

							// send to client
							res.writeHead(200, {'Content-Type': pile.headers[type]});
							res.end(buffer);
						}


					} else {

						// send to client
						res.writeHead(200, {'Content-Type': pile.headers[type]});
						res.end(buffer);
					}

					
				});


			} else {

				// get file etc.
				var file_id = storedLayer.options.file_id;
				var path = '/data/raster_tiles/' + file_id + '/raster/' + params.z + '/' + params.x + '/' + params.y + '.png';
				fs.readFile(path, function (err, buffer) {
					
					// send to client
					res.writeHead(200, {'Content-Type': pile.headers[type]});
					res.end(buffer);
				});
			}

			

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

		var options 	= req.body,
		    column 	= options.column, // gid
		    row 	= options.row, // eg. 282844
		    layer_id 	= options.layer_id,
		    ops 	= [];

		ops.push(function (callback) {

			// retrieve layer and return it to client
			store.layers.get(layer_id, function (err, layer) {
				if (err || !layer) return callback(err || 'no layer');
				callback(null, pile.safeParse(layer));
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
				var data = pile.safeParse(json);
				
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
				callback(null, pile.safeParse(layer));
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

				var arr = stdout.split('\n'),
				    result = [];

				arr.forEach(function (arrr) {
					try {
						var item = JSON.parse(arrr);
						result.push(item);
					} catch (e) {};
				});


				var points = [];
				result.forEach(function (point) {

					// delete geoms
					delete point.geom;
					delete point.the_geom_3857;
					delete point.the_geom_4326;
					
					// push
					points.push(point);
				});

				// calculate averages, totals
				var average = pile._calculateAverages(points);
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

		var options = req.body,
		    column = options.column,
		    access_token = options.access_token,
		    layer_id = options.layer_id,
		    num_buckets = options.num_buckets || 20;

		var ops = [];

		ops.push(function (callback) {
			// retrieve layer and return it to client
			store.layers.get(layer_id, function (err, layer) {
				if (err || !layer) return callback(err || 'no layer');
				callback(null, pile.safeParse(layer));
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

				var arr = stdout.split('\n'),
				    result = [];

				arr.forEach(function (arrr) {
					var item = pile.safeParse(arrr);
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
		


		ops.push(function (callback) {

			// get upload status object from wu
			pile.request.get('/v2/data/import/status', { 	// todo: write more pluggable
				file_id : file_id, 
				access_token : access_token
			}, callback);

		});


		ops.push(function (upload_status, callback) {
			if (!upload_status) return callback('No such upload_status.');

			// safe parse
			var upload_status = pile.safeParse(upload_status);

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
		// vectorize raster (create postgis layer)

		return pile.vectorizeRaster({
			options : options,
			upload_status : upload_status
		}, callback);


		var options 	= req.body,
		    file_id 	= options.file_id,
		    sql 	= options.sql,
		    cartocss 	= options.cartocss,
		    cartocss_version = options.cartocss_version,
		    geom_column = options.geom_column,
		    geom_type 	= options.geom_type,
		    raster_band = options.raster_band,
		    srid 	= options.srid,
		    affected_tables = options.affected_tables,
		    interactivity = options.interactivity,
		    attributes 	= options.attributes,
		    access_token = req.body.access_token;


		// log to file
		console.log({
			type : 'createLayer',
			options : options
		});

		// verify query
		if (!file_id) return pile.error.missingInformation(res, 'Please provide a file_id.')
		

		var ops = [];

		ops.push(function (callback) {

			// // get upload status object from wu
			// pile.request.get('/api/import/status', { 	// todo: write more pluggable
			// 	file_id : file_id, 
			// 	access_token : access_token
			// }, callback);

			callback()

		});


		ops.push(function (upload_status, callback) {
			if (!upload_status) return callback('No such upload_status.');

			var upload_status = JSON.parse(upload_status);

			// check that done importing to postgis
			if (!upload_status.upload_success) return callback('The data was not uploaded correctly. Please check your data and error messages, and try again.')

			// todo: errors

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
		

		async.waterfall(ops, function (err, layerObject) {
			if (err) {
				console.error({
					err_id : 30,
					err_msg : 'create layer',
					error : err
				});
				return res.json({error : err});
			}
			// return layer to client
			res.json(layerObject);
		});

	},


	vectorizeRaster : function (data, done) {

		// create vector table from raster
		// create postgislayer (vector) from new table
		// return layer

		var status = data.upload_status;
		var options = data.options;
		var vectorized_raster_file_id;
		var layerJSON;
		var ops = [];

		ops.push(function (callback) {

			var VECTORIZE_SCRIPT_PATH = 'src/vectorize_raster.sh';

			vectorized_raster_file_id = 'vectorized_raster_' + pile.getRandomChars(20);

			// st_extent script 
			var command = [
				VECTORIZE_SCRIPT_PATH, 	// script
				status.database_name, 	// database name
				vectorized_raster_file_id,
				status.table_name,	// table name
			].join(' ');


			// create database in postgis
			exec(command, {maxBuffer: 1024 * 50000}, function (err, stdout, stdin) {
				// console.log('err, stdout, stdin', err, stdout, stdin);

				options.sql = "(SELECT * FROM " + vectorized_raster_file_id + ") as sub";
				options.table_name = vectorized_raster_file_id;

				// callback
				callback(err);
			});

		});

		ops.push(function (callback) {

			pile._primeTableWithGeometries({
				file_id : vectorized_raster_file_id,
				postgis_db : status.database_name,
			}, callback);

		});

		ops.push(function (callback) {

			return pile._createPostGISLayer({
				upload_status : status,
				options : options
			}, function (err, layer) {
				layerJSON = layer;
				callback(err);
			});
		});
		
		async.series(ops, function (err) {
			done(err, layerJSON);
		});

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
		var ops = [],
		    options = opts.upload_status,
		    file_id = opts.options.file_id,
		    srid 	= opts.options.srid,
		    srid 	= options.srid,
		    access_token = opts.options.access_token;


		// console.log('_createRasterLayer', opts);

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

	_getTileErrorHandler : function (res, err) {
		if (err) console.error({
			err_id : 60,
			err_msg : 'get tile error handler',
			error : err
		});
		res.end();
	},

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

	_serveErrorTile : function (res) {
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

	// _renderVectorTile : function (params, done) {

	// 	pile._prepareTile(params, function (err, map) {
	// 		if (err) console.error({
	// 			err_id : 3,
	// 			err_msg : 'render vector',
	// 			error : err
	// 		});
	// 		if (err) return done(err);

	// 		var map_options = {
	// 			variables : { 
	// 				zoom : params.z // insert min_max etc 
	// 			}
	// 		}

	// 		// vector
	// 		var im = new mapnik.VectorTile(params.z, params.x, params.y);
			
	// 		// check
	// 		if (!im) return callback('Unsupported type.')

	// 		// render
	// 		map.render(im, map_options, function (err, tile) {
	// 			if (err) console.error({
	// 				err_id : 4,
	// 				err_msg : 'render vector',
	// 				error : err
	// 			});

	// 			store._saveVectorTile(tile, params, done);
	// 		});
	// 	});
		
	// },

	_renderVectorTile : function (params, done) {

		// prepare tile: 
		// parse url into layerUuid, zxy, type
		var ops = [];
		var map,
		    layer,
		    postgis,
		    bbox;

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

			var storedLayer = pile.safeParse(storedLayer);

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
			// pile.cartoRenderer(storedLayer.options.cartocss, layer, callback);
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

			console.log('preparedTile XML: ', map.toXML());
			// debug write xml
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
			// var im = new mapnik.Image(64, 64);

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
		var map,
		    layer,
		    postgis,
		    bbox;

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

			var storedLayer = pile.safeParse(storedLayer);

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
			// pile.cartoRenderer(storedLayer.options.cartocss, layer, callback);
			pile.cartoRenderer(storedLayer, layer, callback);

		});

		// load xml to map
		ops.push(function (xml, callback) {
			map.fromString(xml, {strict : true}, callback);
		});

		// run ops
		async.waterfall(ops, done);

	},

	// return tiles from redis/disk or created
	getVectorTile : function (params, storedLayer, done) {

		// check redis
		store._readVectorTile(params, function (err, data) {

			// return data
			if (data) return done(null, data);

			// create
			pile.createVectorTile(params, storedLayer, done);
		});
	},

	getRasterTile : function (params, storedLayer, done) {

		// check cache
		store._readRasterTile(params, function (err, data) {

			// return data
			if (data) return done(null, data);
			
			// create
			pile.createRasterTile(params, storedLayer, done);
		});
	},
	
	getGridTile : function (params, storedLayer, done) {

		// check cache
		pile._getGridTileFromRedis(params, function (err, data) {

			// found, return data
			if (data) return done(null, data);

			// not found, create
			pile.createGridTile(params, storedLayer, done);
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

	// get tiles from redis
	_getRasterTileFromRedis : function (params, done) {
		var keyString = 'raster_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		store.layers.get(key, done);
	},
	_getVectorTileFromRedis : function (params, done) {
		var keyString = 'vector_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		store.layers.get(key, done);
	},
	_getGridTileFromRedis : function (params, done) {
		var keyString = 'grid_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		store.layers.get(keyString, done);
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


	// convert CartoCSS to Mapnik XML
	cartoRenderer : function (storedLayer, layer, callback) {

		var css = storedLayer.options.cartocss;

		if ( ! css ) {
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

			//console.log("XXXX about to render " + JSON.stringify(options));

			// carto renderer
			var xml = new carto.Renderer().render(options);
			callback(null, xml);

		} catch (e) {
			//console.log("XXXX carto.Renderer().render() threw ", e);
			var err = { message : 'CartoCSS rendering failed: ' + e.toString() }
			callback(err);
		}


	},

	_debugXML : function (layer_id, xml) {
		console.log('xml:', xml);
		var xml_filename = 'tmp/' + layer_id + '.debug.xml';
		fs.outputFile(xml_filename, xml, function (err) {
			if (!err) console.log('wrote xml to ', xml_filename);
		});
	},


	// // todo: old code, but we prob need this?
	// getFile : function (req, res) {
		
	// 	// get access token
	// 	var access_token = pile._getAccessToken(req),
	// 	    file_id = req.query.file_id,
	// 	    ops = [];

	// 	// no access
	// 	if (!access_token) return pile.error.noAccess(res);

	// 	// check for missing info
	// 	if (!file_id) return pile.error.missingInformation(res, 'file_id');

	// 	// todo: check permission to access file
		
	// 	// get from wu
	// 	pile.request.get('/api/bridge/getFile', {
	// 		file_id : file_id,
	// 		access_token : access_token
	// 	}, function (err, results) {
		
	// 	});
	// },


	safeParse : function (string) {
		try {
			var o = JSON.parse(string);
			return o;
		} catch (e) {
			console.log('JSON.parse error of string:', string, e);
			return false;
		}
	},

	request : {

		get : function (endpoint, options, callback) {
			var baseUrl = 'http://wu:3001',
			    params = '';
			if (_.size(options)) {
				params += '?';
				var n = _.size(options);
				for (o in options) {
					params += o + '=' + options[o];
					n--;
					if (n) params += '&'
				}
			}

			request({
				method : 'GET',
				uri : baseUrl + endpoint + params
			}, function (err, response, body) {
				callback(err, body);
			}); 
		},
	},
	

	_getAccessToken : function (req) {
		var access_token = req.query.access_token || req.body.access_token;
		return access_token;
	},

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
		proxy._getTile(options, function (err) {
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
