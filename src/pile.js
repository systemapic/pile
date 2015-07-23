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

// modules
var server = require('./server');
var config = require('../config/pile-config');

// mercator
var mercator = require('./sphericalmercator');

// register mapnik plugions
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();

// database schemas
var Project 	 = require('../models/project');
var Clientel 	 = require('../models/client');	
var User  	 = require('../models/user');
var File 	 = require('../models/file');
var Layer 	 = require('../models/layer');
var Hash 	 = require('../models/hash');
var Role 	 = require('../models/role');
var Group 	 = require('../models/group');

// connect to our database
mongoose.connect(config.mongo.url); 

// global paths
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var CARTOCSSPATH = '/data/cartocss/';
var GEOJSONPATH  = '/data/geojson/';
var STYLEPATH    = '/data/stylesheets/';
var UTFGRIDPATH  = '/data/utfgrids/';
var METAPATH 	 = '/data/meta/';

// mute console in production mode
if (process.argv[2] == 'production') {
	var nullFn = function () {};
	console.log = nullFn;
	console.time = nullFn;
	console.timeEnd = nullFn;
}

// #########################################
// ### Vector, raster, utfgrid handling  ###
// #########################################
// vector/raster/utfgrid handling
module.exports = pile = { 


	// this layer is only a postgis layer. a Wu Layer Model must be created by client after receiving this postgis layer
	createLayer : function (req, res) {
		// console.log('PILE createLayer');

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
		    // projectUuid = req.body.projectUuid;

		// verify query
		if (!file_id) 	return pile.error.missingInformation(res, 'Please provide a file_id.')
		if (!sql) 	return pile.error.missingInformation(res, 'Please provide a SQL statement.')
		if (!cartocss) 	return pile.error.missingInformation(res, 'Please provide CartoCSS.')

		var ops = [];

		ops.push(function (callback) {

			// get upload status object from wu
			pile.request.get('/api/import/status', { 	// todo: write more pluggable
				file_id : file_id, 
				access_token : access_token
			}, callback);


		});

		ops.push(function (upload_status, callback) {
			if (!upload_status) return callback('No such upload_status.');

			var upload_status = JSON.parse(upload_status);

			// check that done importing to postgis
			if (!upload_status.upload_success) return callback('The data was not uploaded correctly. Please check your data and error messages, and try again.')

			// todo: errors

			// check that done importing to postgis
			if (!upload_status.processing_success) return callback('The data is not done processing yet. Please try again in a little while.')

			// all good
			callback(null, upload_status);
		});

		ops.push(function (options, callback) {

			// inject table name into sql
			var done_sql = sql.replace('table', options.table_name);

			// create layer object
			var layerUuid = 'layer-' + uuid.v4();
			var layer = { 	

				layerUuid : layerUuid,
				options : {			
					
					// required
					sql : done_sql,
					sql_id : new Buffer(done_sql).toString('base64'),
					cartocss : cartocss,
					file_id : file_id, 	
					database_name : options.database_name, 
					table_name : options.table_name, 
					metadata : options.metadata,
					layer_id : layerUuid,
					wicked : 'thing',

					// optional				// defaults
					cartocss_version : cartocss_version 	|| '2.0.1',
					geom_column : geom_column 		|| 'geom',
					geom_type : geom_type 			|| 'geometry',
					raster_band : raster_band 		|| 0,
					srid : srid 				|| 3857,
					// affected_tables : affected_tables 	|| [],
					// attributes : attributes 		|| {}
				}
			}

			callback(null, layer);

		});


		// save layer to layerStore
		ops.push(function (layer, callback) {

			// save layer to layerStore
			layerStore.set(layer.layerUuid, JSON.stringify(layer), function (err) {
				if (err) return callback(err);

				callback(null, layer);
			});
		});

		// // create layer model
		// ops.push(function (layer, callback) {

		// 	pile._createLayerModel(layer, callback);

		// });


		async.waterfall(ops, function (err, layerObject) {
			console.log('>>>>>>>>>>>>>>>>>>')
			console.log('>>>>>>>>>>>>>>>>>> Created layer ');
			console.log('>>>>>>>>>>>>>>>>>>')
			console.log(layerObject);
			
			// return layer to client
			res.json(layerObject);
		});


	},


	getLayer : function (req, res) {

		// get layerUuid
		var layerUuid = req.body.layerUuid || req.query.layerUuid;
		if (!layerUuid) return pile.error.missingInformation(res, 'Please provide layerUuid.');

		// retrieve layer and return it to client
		layerStore.get(layerUuid, function (err, layer) {
			res.end(layer);
		});
	},

	headers : {
		png : 'image/png',
		pbf : 'application/x-protobuf',
		grid : 'application/json'
	},

	getTile : function (req, res) {

		// parse url into layerUuid, zxy, type
		var ops = [],
		    // https://dev.systemapic.com/api/tiles/layerUuid/z/x/y.png || .pbf
		    parsed = req._parsedUrl.pathname.split('/'), 
		    params = {
			layerUuid : parsed[2],
			z : parseInt(parsed[3]),
			x : parseInt(parsed[4]),
			y : parseInt(parsed[5].split('.')[0]),
			type : parsed[5].split('.')[1],
		    };

	

		// check params
		if (!params.layerUuid) 	return pile.error.missingInformation(res, 'Invalid url: Missing layerUuid.');
		if (!params.z) 		return pile.error.missingInformation(res, 'Invalid url: Missing tile coordinates.');
		if (!params.x) 		return pile.error.missingInformation(res, 'Invalid url: Missing tile coordinates.');
		if (!params.y) 		return pile.error.missingInformation(res, 'Invalid url: Missing tile coordinates.');
		if (!params.type) 	return pile.error.missingInformation(res, 'Invalid url: Missing type (extension).');


		// three possible formats, png, pbf, grid
		// all three may be in cache
		// 
		// check cache, serve
		//
		// 

		var map,
		    layer,
		    postgis,
		    bbox;
		var type = params.type;
		var ops = [];


		// get stored layer
		layerStore.get(params.layerUuid, function (err, storedLayerJSON) {	
			if (err || !storedLayerJSON) return callback(err || 'No such layer_id stored.');
			var storedLayer = JSON.parse(storedLayerJSON);



			
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
				// console.log('GET TIEL err, DATA: ', err, data);
				var data = data[0];

				// send to client
				res.writeHead(200, {'Content-Type': pile.headers[type]});
				res.end(data);
			});

		});

		// ops.push(function (callback) {

		// 	// try to get tiles from redis first
		// 	pile._getTileFromRedis(params, function (err, data) {
				
		// 		// got from cache, return serve
		// 		if (!err && data) {
		// 			console.log('from redis');
		// 			res.writeHead(200, {'Content-Type': pile.headers[params.type]});
		// 			res.end(data);
		// 			return callback(true); // end async
		// 		}

		// 		// no tile in cache
		// 		callback(null);
		// 	});

		// });

		// ops.push(function (callback) {
		// 	// check for vector tile for png/grid
		// 	// if type needed is vector tile, skip cause already looked for it, create vector tile

		// 	// get vector tile (create if doesnt exist) 
		// 	pile.getVectorTile(params, storedLayer, function (err, vtile) {

		// 		// create raster tile
		// 		if (params.type == 'png') pile.getRasterTile(params, storedLayer, function (err, png) {

		// 		});


		// 		// create grid tile
		// 		if (params.type == 'grid') pile.getGridTile(params, storedLayer, function (err, png) {

		// 		});

		// 	});

		// });

		// // create vector tile
		// ops.push(function (callback) {

		// });

		// ops.push(function (callback) {

		// });


		// async.series(ops, function (err, results) {
		// 	console.log('Served tile.', err);
		// });



		// // try to get tiles from redis first
		// pile._getTileFromRedis(params, function (err, data) {
			
		// 	// got from cache, return serve
		// 	if (!err && data) {
		// 		console.log('from redis');
		// 		res.writeHead(200, {'Content-Type': 'image/png'});
		// 		res.end(data);
		// 		return;
		// 	}


			
			
		// });

		// console.log('##############################################')
		// // debug, write redis file
		// var logfile = '/var/www/pile/test/create_tile_time.log';
		// fs.exists(logfile, function(exists) { 
		// 	if (exists) return; 

		// 	layerStore.lrange('timer:create_tile', [0, 10000000000000000], function (err, list) {
		// 		console.log('list: ', list);
		// 		fs.outputFile(logfile, list, function (err) {

		// 		})
		// 	})
		// }); 





		
	},

	_createVectorTile : function (params, storedLayer, done) {

		// KUE: create raster tile
		var start = new Date().getTime();
		var job = jobs.create('render_vector_tile', { // todo: cluster up with other machines, pluggable clusters
			params : params,
			storedLayer : storedLayer
		}).priority('high').attempts(5).save();


		// KUE DONE: raster created
		job.on('complete', function (result) {

			// stats
			var end = new Date().getTime();
			var create_tile_time = end - start;
			console.log('Created vector tile', create_tile_time);
			layerStore.lpush('timer:create_tile', create_tile_time);
			
			// get tile
			pile._getVectorTileFromRedis(params, storedLayer, done);
		});


	},

	_createRasterTile : function (params, storedLayer, done) {

		// KUE: create raster tile
		var start = new Date().getTime();
		var job = jobs.create('render_raster_tile', { // todo: cluster up with other machines, pluggable clusters
			params : params,
			storedLayer : storedLayer
		}).priority('high').attempts(5).save();


		// KUE DONE: raster created
		job.on('complete', function (result) {
			
			// stats
			var end = new Date().getTime();
			var create_tile_time = end - start;
			// console.log('Created tile', create_tile_time);
			layerStore.lpush('timer:create_tile', create_tile_time);
			
			// get tile
			pile._getRasterTileFromRedis(params, done);
		});


	},

	

	getVectorTile : function (params, storedLayer, done) {

		// look for in redis
		// vector tiles stored on sql id, not style id. 

		pile._getVectorTileFromRedis(params, storedLayer, function (err, data) {
			if (data) return done(null, data);

			// create
			pile._createVectorTile(params, storedLayer, function (err, data) {
				return done(err, data);
			});
		});
			

	},

	getRasterTile : function (params, storedLayer, done) {

		// check cache
		pile._getRasterTileFromRedis(params, function (err, data) {
			if (data) return done(null, data);


			// create
			pile._createRasterTile(params, storedLayer, done);
		});
	},

	_getRasterTileFromRedis : function (params, done) {

		// get tile from redis
		var keyString = 'tile_png:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		layerStore.get(key, done);
	},

	_getVectorTileFromRedis : function (params, storedLayer, done) {
		// get tile, based on file + sql
		var keyString = 'tile_pbf:' + storedLayer.file_id + ':' + storedLayer.sql_id + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		layerStore.get(key, done);
	},


	_renderRasterTile : function (params, done) {

		var ops = [],
		    storedLayer;

		// check valid params
		ops.push(function (callback) {
			pile.checkParams(params, callback);
		});
		
		// look for stored layerUuid
		ops.push(function (callback) {
			layerStore.get(params.layerUuid, function (err, storedLayerJSON) {
				if (err || !storedLayerJSON) return callback(err || 'No such layer_id. 433');
				storedLayer = JSON.parse(storedLayerJSON);
				callback(null);
			});
		});


		// get vector tile
		ops.push(function (callback) {

			// get vector tile
			pile.getVectorTile(params, storedLayer, function (err, vector_data) {
				// console.log('getVectorTile: ', err, vector_data);

				// parse vtile

				var vtile = new mapnik.VectorTile(params.z, params.x, params.y);

				vtile.setData(vector_data || new Buffer(), function (err) {
					// console.log('setData: ', err, vtile);
					// console.log('----------------------');
					// console.log('vtile.empty()', vtile.empty());


					if (err) return callback(err);

					if (!vtile.empty()) vtile.parse();

					// create map
					var map = new mapnik.Map(256, 256, mercator.proj4);

					// set buffer
					map.bufferSize = 64;
					
					// parse xml from cartocss
					pile.cartoRasterRenderer(storedLayer.options.cartocss, [{id : 'layer', name : 'layer'}], function (err, xml) {

						// console.log('xml: ', xml);

						map.fromString(xml, {strict : true}, function (err, result_map) {

							var options = {
								buffer_size : 10,
								variables : {
									zoom : params.z
								}
							};

							// console.time('Rendered Raster Tile');
							vtile.render(map, new mapnik.Image(256,256), options, function(err, raster_tile) {

								// save png to redis
								var keyString = 'tile_png:' + storedLayer.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
								var key = new Buffer(keyString);
								layerStore.set(key, raster_tile.encodeSync('png'), callback);

							});

						});
					});

				})

			

			});
		});

		// // send tile to client
		// ops.push(function (callback) {

		// 	// save png to redis
		// 	var keyString = 'tile_png:' + storedLayer.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		// 	var key = new Buffer(keyString);
		// 	layerStore.set(key, data.encodeSync('png'), callback);
		// });


		// run ops
		async.waterfall(ops, function (err) {
			// console.log('async done, err, result', err);
			done(err);
		});


	},


	checkParams : function (params, done) {

		if (!params.layerUuid) 	return done('Invalid url: Missing layerUuid.');
		if (!params.z) 		return done('Invalid url: Missing tile coordinates.');
		if (!params.x) 		return done('Invalid url: Missing tile coordinates.');
		if (!params.y) 		return done('Invalid url: Missing tile coordinates.');
		if (!params.type) 	return done('Invalid url: Missing type extension.');

		return done(null);
	},

	_renderVectorTile : function (params, done) {

		// parse url into layerUuid, zxy, type
		var ops = [];
		var map,
		    layer,
		    postgis,
		    bbox,
		    storedLayer;


		// check valid params
		ops.push(function (callback) {
			pile.checkParams(params, callback);
		});
		
		// look for stored layerUuid
		ops.push(function (callback) {
			layerStore.get(params.layerUuid, callback);
		});

		// define settings, xml
		ops.push(function (storedLayerJSON, callback) {
			if (!storedLayerJSON) return callback('No such layerUuid.');

			storedLayer = JSON.parse(storedLayerJSON);

			// console.log('storedLayer: ', storedLayer);

			// default settings // todo: put in config
			var default_postgis_settings = {
				user : 'docker',
				password : 'docker',
				host : 'postgis',
				type : 'postgis',
				geometry_field : 'the_geom_3857',
				srid : '3857'
			}

			// insert layer settings 
			var postgis_settings = default_postgis_settings;
			postgis_settings.dbname = storedLayer.options.database_name;
			postgis_settings.table 	= storedLayer.options.sql;
			// postgis_settings.geometry_field = storedLayer.options.geom_column;
			// postgis_settings.srid = storedLayer.options.srid;
			
			// everything in spherical mercator (3857)!
			try {
				map = new mapnik.Map(256, 256, mercator.proj4);
				layer = new mapnik.Layer('layer', mercator.proj4);
				postgis = new mapnik.Datasource(postgis_settings);
				bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);
			} catch (e) {
				return callback(e.message);
			}

			// set buffer
			map.bufferSize = 64;

			// set datasource
			layer.datasource = postgis;

			// add styles
			layer.styles = ['layer']; // style names in xml, todo!
			
			// add layer to map
			map.add_layer(layer);

			// parse xml from cartocss
			pile.cartoRenderer(storedLayer.options.cartocss, layer, callback);

		});

		// load xml to map
		ops.push(function (xml, callback) {
			map.fromString(xml, {strict : true}, callback);
		});

		// render vector/raster tile
		ops.push(function (map, callback) {

			// get variables
			pile.getVariables(storedLayer, function (err, variables) {

				// set zoom var
				variables.zoom = params.z;

				// https://github.com/mapnik/node-mapnik/blob/a972ab71aa9a7d2b4047f7e9586c4f8dd7e23c35/docs/VectorTile.md
				// variables: Mapnik 3.x ONLY: A javascript object containing key value pairs that should be passed into Mapnik as variables 
				// for rendering and for datasource queries. For example if you passed vtile.render(map,image,{ variables : {zoom:1} },cb) 
				// then the @zoom variable would be usable in Mapnik symbolizers like line-width:"@zoom" and as a token in Mapnik postgis 
				// sql sub-selects like (select * from table where some_field > @zoom) as tmp.

				// set extent
				map.extent = bbox; // must have extent!

				// create vector tile
				var im = new mapnik.VectorTile(params.z, params.x, params.y);

				// render
				map.render(im, { 
					variables : variables
				}, callback);

			});

		});

		// todo: SAVE TO REDIS HERE!

		// send tile to client
		ops.push(function (tile, callback) {

			// console.log('################ CREATED VECTOR TILE ##################');
			// console.log('tile.names()', tile.names());
			// console.log('tile.empty()', tile.empty());
			// console.log('tile.toJSON()', tile.toJSON());


			// save png to redis
			var keyString = 'tile_pbf:' + storedLayer.file_id + ':' + storedLayer.sql_id + ':' + params.z + ':' + params.x + ':' + params.y;
			var key = new Buffer(keyString);
			layerStore.set(key, tile.getData(), callback);
		});


		// run ops
		async.waterfall(ops, function (err) {
			// console.log('async done, err, result', err);
			done(err);
		});

	},











	getVariables : function (layer, done) {

		// get scale_max_height, scale_min_height, _vel, _demerr, etc. max/min/avg/med for all columns

		done(null, {});
		// done(null, {
		// 	scale_max_height : 1615,
		// 	scale_min_height : 600,
		// 	scale_max_vel : -50,
		// 	scale_min_vel : -200
		// });


	},



	// convert CartoCSS to Mapnik XML
	cartoRenderer : function (css, layer, callback) {

		// console.log('>>>>>>>>>>>>>>>>>> layer', layer);

		var options = {
			// srid 3857
			"srs": "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over",

			"Stylesheet": [{
				"id" : 'tile_style',
				"data" : css
			}],
			// "Layer": [{
			// 	// "id" : "tile_id",	// not reflected anywhere in xml
			// 	"name" : "tile" 	// name of <Layer>
			// }]
			"Layer" : [layer]
		}

		try  {

			// carto renderer
			var xml = new carto.Renderer().render(options);

			// get xml from 
			// var xml = cr.render(options);

			callback(null, xml);

		} catch (e) {
			// console.log('ERR 17'.red, e);
			
			var err = {
				message : e
			}
			callback(err);
		}


	},

	// convert CartoCSS to Mapnik XML
	cartoRasterRenderer : function (css, layer, callback) {

		// console.log('>>>>>>>>>>> cartoRasterRenderer >>>>>>> layer', layer);

		var options = {
			// srid 3857
			"srs": "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over",

			"Stylesheet": [{
				"id" : 'cool_style',
				"data" : css
			}],
			"Layer": [{
				"id" : "tile_layer",	// not reflected anywhere in xml
				"name" : "layer" 	// name of <Layer>
			}]
			// "Layer" : [layer]
		}

		try  {

			// carto renderer
			var xml = new carto.Renderer().render(options);

			// get xml from 
			// var xml = cr.render(options);

			callback(null, xml);

		} catch (e) {
			// console.log('ERR 17'.red, e);
			
			var err = {
				message : e
			}
			callback(err);
		}


	},



	getFile : function (req, res) {
		// console.log('req.query', req.query);
		
		// get access token
		var access_token = pile._getAccessToken(req),
		    file_id = req.query.file_id,
		    ops = [];

		// no access
		if (!access_token) return pile.error.noAccess(res);

		// check for missing info
		if (!file_id) return pile.error.missingInformation(res, 'file_id');

		// todo: check permission to access file
		
		// get from wu
		pile.request.get('/api/bridge/getFile', {
			file_id : file_id,
			access_token : access_token
		}, function (err, results) {
			// console.log('pile.request.get: ', err, results);
		});

	
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
				// json : options
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
				error : 'Unauthenticated.'
			});
		},
	}

}





// #########################################
// ###  Initialize Kue                   ###
// #########################################
// init kue
var jobs = kue.createQueue({
   	redis : config.kueRedis,
   	prefix : 'vq'
});

// #########################################
// ###  Redis for Layer Storage          ###
// #########################################
// configure redis for token auth
var redis = require('redis');
var layerStore = redis.createClient(config.tokenRedis.port, config.tokenRedis.host, {detect_buffers : true})
layerStore.auth(config.tokenRedis.auth);
layerStore.on('error', function (err) { console.error(err); });





// #########################################
// ###  Clusters                         ###
// #########################################
// master cluster:
if (cluster.isMaster) { 

	// start server
	server(pile);

	console.log('Cluster...'.bgYellow.black);
	for (var i = 0; i < numCPUs - 2; i++) {  // 6 cpus
		// fork workers
		cluster.fork(); 
	} 

	// listen to exit, keep alive
	cluster.on('exit', function(worker, code, signal) { 
		console.log('__________________Cluster died, respawning__________________________________'.red);
		cluster.fork(); 
	});


} else {
// worker clusters, kues:

	console.log('...clustering!'.yellow);

	// #########################################
	// ###  Kue jobs: Vector render          ###
	// #########################################
	// render vector job
	jobs.process('render_vector_tile', 10, function (job, done) {

		var params = job.data.params;

		pile._renderVectorTile(params, function (err) {
			if (err) console.log('create_tile cluster fuck', err);
			done();
		});
	});

	// render vector job
	jobs.process('render_raster_tile', 10, function (job, done) {

		var params = job.data.params;

		pile._renderRasterTile(params, function (err) {
			if (err) console.log('create_tile cluster fuck', err);
			done();
		});
	});

	// remove stale jobs
	jobs.on('job complete', function (id) {
		kue.Job.get(id, function (err, job) {
			if (err) return;
			job.remove(function (err) {
				if (err) console.log(err);
			});
		});
	});

}


