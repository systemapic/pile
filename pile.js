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
// var mapnikOmnivore = require('mapnik-omnivore');
var mercator = require('./sphericalmercator');
var request = require('request');

// modules
var server = require('./server');
var config = require('./config/pile-config');

// register mapnik plugions
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();
// mapnik.register_datasource(path.join(mapnik.settings.paths.input_plugins,'ogr.input'));

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



	createLayer : function (req, res) {
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

		// verify query
		if (!file_id) 	return pile.error.missingInformation(res, 'Please provide a file_id.')
		if (!sql) 	return pile.error.missingInformation(res, 'Please provide a SQL statement.')
		if (!cartocss) 	return pile.error.missingInformation(res, 'Please provide CartoCSS.')

		var ops = [];

		ops.push(function (callback) {

			console.log('file_id:::::', file_id);

			// get upload status object from wu
			// check if upload is done, processing is done
			pile.request.get('/api/import/status', {
				file_id : file_id, 
				access_token : access_token
			}, callback);


		});

		ops.push(function (upload_status, callback) {
			if (!upload_status) return callback('No such upload_status.');

			var upload_status = JSON.parse(upload_status);

			// check that done importing to postgis
			if (!upload_status.upload_success) return callback('The data was not uploaded correctly. Please check your data and error messages, and try again.')

			// check that done importing to postgis
			if (!upload_status.processing_success) return callback('The data is not done processing yet. Please try again in a little while.')

			// all good
			callback(null, upload_status);
		});

		ops.push(function (options, callback) {

			// inject table name into sql
			var done_sql = sql.replace('table', options.table_name);

			// create layer object
			var layer = { 	

				layerUuid : 'layer-' + uuid.v4(),	
				options : {			
					
					// required
					sql : done_sql,
					cartocss : cartocss,
					file_id : file_id, 	
					database_name : options.database_name, 
					table_name : options.table_name, 	

					// optional				// defaults
					cartocss_version : cartocss_version 	|| '2.0.1',
					geom_column : geom_column 		|| 'geom',
					geom_type : geom_type 			|| 'geometry',
					raster_band : raster_band 		|| 0,
					srid : srid 				|| 3857,
					affected_tables : affected_tables 	|| [],
					attributes : attributes 		|| {}
				}
			}

			// save layer to layerStore
			layerStore.set(layer.layerUuid, JSON.stringify(layer), function (err) {
				if (err) return callback(err);

				callback(null, layer);
			});

		});


		async.waterfall(ops, function (err, layer) {

			// return layer to client
			res.json(layer);
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





	getTile : function (req, res) {

		console.time('getTile');
		// parse url into layerUuid, zxy, type
		var ops = [],
		    parsed = req._parsedUrl.pathname.split('/'), // https://dev.systemapic.com/api/tiles/layerUuid/z/x/y.png || .pbf
		    params = {
			layerUuid : parsed[2],
			z : parseInt(parsed[3]),
			x : parseInt(parsed[4]),
			y : parseInt(parsed[5].split('.')[0]),
			type : parsed[5].split('.')[1],
		    },
		    map,
		    layer,
		    postgis,
		    bbox;

		// check params
		console.log('params', params);
		if (!params.layerUuid) 	return pile.error.missingInformation(res, 'Invalid url: Missing layerUuid.');
		if (!params.z) 		return pile.error.missingInformation(res, 'Invalid url: Missing tile coordinates.');
		if (!params.x) 		return pile.error.missingInformation(res, 'Invalid url: Missing tile coordinates.');
		if (!params.y) 		return pile.error.missingInformation(res, 'Invalid url: Missing tile coordinates.');
		if (!params.type) 	return pile.error.missingInformation(res, 'Invalid url: Missing type (extension).');


		// look for stored layerUuid
		ops.push(function (callback) {
			layerStore.get(params.layerUuid, callback);
		});

		// define settings, xml
		ops.push(function (storedLayer, callback) {
			if (!storedLayer) return callback('No such layerUuid.');

			var storedLayer = JSON.parse(storedLayer);

			console.log('storedLayer: ', storedLayer);

			// default settings // todo: put in config
			var default_postgis_settings = {
				user : 'docker',
				password : 'docker',
				host : 'postgis',
				type : 'postgis'
			}

			// insert layer settings 
			var postgis_settings 	= default_postgis_settings;
			postgis_settings.dbname = storedLayer.options.database_name;
			postgis_settings.table 	= storedLayer.options.sql;
			postgis_settings.geometry_field = storedLayer.options.geom_column;
			postgis_settings.srid 	= storedLayer.options.srid;
			
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
			layer.styles = ['layer']; // style names in xml
			
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

			// console.log(map.toXML()); // Debug settings

			// set extent
			map.extent = bbox; // must have extent!

			// raster
			if (params.type == 'png') {
				var im = new mapnik.Image(map.width, map.height);
			}
			
			// vector
			if (params.type == 'pbf') {
				var im = new mapnik.VectorTile(params.z, params.x, params.y);
			}

			// check
			if (!im) return callback('Unsupported type.')

			// render
			map.render(im, callback);

		});

		// send tile to client
		ops.push(function (tile, callback) {

			// return raster
			if (params.type == 'png') {
				res.writeHead(200, {'Content-Type': 'image/png'});
	               		res.end(tile.encodeSync('png'));
	               		return callback(null);
	               	}

	               	// return vector
	               	if (params.type == 'pbf') {
				res.setHeader('Content-Encoding', 'deflate')
				res.setHeader('Content-Type', 'application/x-protobuf')
				return zlib.deflate(tile.getData(), function(err, pbf) {
					res.send(pbf)
					callback(err);
				});
	               	}

	               	callback('Unsupported tile format.')
		});


		// run ops
		async.waterfall(ops, function (err) {
			console.log('async done, err, result', err);
			if (err) return res.json({error : err.message});
			console.timeEnd('getTile');

		});

	},



	getRasterTile : function (storedLayer, params, done) {

		// flow: 
		// 
		// 1. check for existing png 
		// 2. create xml from cartocss
		// 3. create raster from xml + postgis
		// 4. save to disk
		// 5. serve

		
		// layer:  { 
		// 	layerUuid: 'layer-1d34666c-d8a8-4fce-994e-e042a17bbe7d',
		// 	options: { 
		// 		sql: 'SELECT * FROM file_suhrcucstpmtxqgtpyyc',
		// 		cartocss: '#layer {}',
		// 		file_id: 'file_suhrcucstpmtxqgtpyyc',
		// 		database_name: 'zzjihbcpqm',
		// 		table_name: 'file_suhrcucstpmtxqgtpyyc',
		// 		cartocss_version: '2.0.1',
		// 		geom_column: 'geom',
		// 		geom_type: 'geometry',
		// 		raster_band: 0,
		// 		srid: 3857,
		// 		affected_tables: [],
		// 		attributes: {} 
		// 	} 
		// }
		// params:  { 
		// 	layerUuid: 'layer-1d34666c-d8a8-4fce-994e-e042a17bbe7d',
		// 	z: '0',
		// 	x: '0',
		// 	y: '0',
		// 	type: 'png' 
		// }

		// return done();

		// // 14/10124/6322
		// var params = {
		// 	// z : 13, // cadastral
		// 	// x : 7533,
		// 	// y : 4915,
		// 	z : 14,
		// 	x : 10124,
		// 	y : 6322,
		// 	style : 'points'
		// 	// z : 0,
		// 	// x : 0,
		// 	// y : 0,
		// }

		// var postgis_settings = {
		// 	'dbname' 	: 'zzjihbcpqm',
		// 	// 'table' 	: '(select * from shape_nsziadryou where area > 100000) as mysubquery', // works!!
		// 	// 'table' 	: '(select * from shape_nsziadryou where area > 300000) as mysubquery',
		// 	// 'table' 	: 'shape_ozpnkswisx',
		// 	// 'table' 	: '(select * from shape_ozpnkswisx where area_m2 > 1000) as sub', // works!
		// 	// 'table' 	: '(select * from shape_ozpnkswisx where area_m2 > 1000) as sub', // works!
		// 	// 'table' 	: 'shape_ubpdiiswel',
		// 	// 'table' 	: '(select * from shape_ubpdiiswel where vel < -50) as sub',
		// 	'table' 	: '(select * from shape_ubpdiiswel where ST_Intersects(geom, !bbox!)) as sub',
		// 	'user' 		: 'docker',
		// 	'password' 	: 'docker',
		// 	'host' 		: 'postgis',
		// 	'type' 		: 'postgis',
		// 	'geometry_field': 'geom',
		// 	'srid' 		: '3857',
		// 	// 'extent' 	: '16813700.23783365, -4011415.24440605, 16818592.2076439, -4006523.2745957985'  //change this if not merc
		// 	// 'extent' 	: '-20005048.4188,-9039211.13765,19907487.2779,17096598.5401'
		// }

		// debug
		console.log('============ pile.getRasterTile ============');
		console.log('============ pile.getRasterTile ============');
		console.log('============ pile.getRasterTile ============');
		console.log('layer: ', layer);
		console.log('params: ', params);

		// // default settings // todo: put in config
		// var default_postgis_settings = {
		// 	user : 'docker',
		// 	password : 'docker',
		// 	host : 'postgis',
		// 	type : 'postgis'
		// }

		// // insert layer settings 
		// var postgis_settings = default_postgis_settings;
		// postgis_settings.dbname = storedLayer.options.database_name;
		// postgis_settings.table = storedLayer.options.sql;
		// postgis_settings.geometry_field = storedLayer.options.geom_column;
		// postgis_settings.srid = storedLayer.options.srid;
		
		// // everything in spherical mercator (3857)!
		// var map = new mapnik.Map(256, 256, mercator.proj4);
		// var layer = new mapnik.Layer('layer', mercator.proj4);
		// var postgis = new mapnik.Datasource(postgis_settings);
		// var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

		// // set buffer
		// map.bufferSize = 64;

		// // set datasource
		// layer.datasource = postgis;



		// // |
		// // |
		// // v
		// // everything down to here is same for vector/raster
		// // ----------------------------------------------------------------------

		// layer.styles = ['layer']; // style names in xml
		// map.add_layer(layer);

		var ops = [];

		ops.push(function (callback) {
			pile.cartoRenderer(storedLayer.options.cartocss, layer, callback);
		});

		
		ops.push(function (xml, callback) {
			map.fromString(xml, {strict : true}, callback);
		});

		ops.push(function (map, callback) {

			// console.log(map.toXML()); // Debug settings

			map.extent = bbox; // must have extent!

			// raster
			if (params.type == 'png') {
				var im = new mapnik.Image(map.width, map.height);
			}
			
			// vector
			if (params.type == 'pbf') {
				var im = new mapnik.VectorTile(params.z, params.x, params.y);
			}

			// render
			map.render(im, callback);

		});

		// return buffer
		async.waterfall(ops, done);


		// async.waterfall(ops, function (err, im) {

		// 	console.log('map.render err, im', err, im);
		// 	fs.outputFile('./raster_1.png', im.encodeSync('png'));
		// 	// fs.writeFileSync("./cetin3.pbf", im.getData());

		// 	// console.log('vector_tile: ', im.names(), im.toJSON());
		// 	// var json = im.toJSON();
		// 	// console.log('json.features');
		// 	// console.log(json[0].features);
		

		// 	// console.timeEnd('CREATE RASTER');

		// 	// callback(err, im);

		// 	// res.end('ok');
		// 	done();

		// });


		// return done();

		// layer.styles = [params.style]; // todo!

		// todo here: 	cartocss -> xml
		// 		insert names for layer.styles (polygon, point, whatever.. must match stylesheet layer name?)
		// 		save rasters to folder structure
		//		save in redis which rasters have been made? (faster lookup than on disk?)

		// map.load(path.join(__dirname, params.style + '.xml'), { strict: true }, function(err,map) {
		// 	if (err) throw err;
		// 	map.add_layer(layer);

		// 	console.log(map.toXML()); // Debug settings

		// 	map.extent = bbox; // must have extent!
		// 	var im = new mapnik.Image(map.width, map.height);

		// 	// var im = new mapnik.VectorTile(0,0,0);

		// 	map.render(im, function(err, im) {
		// 		console.log('map.render err, im', err, im);
		// 		fs.outputFile('./cetin3.png', im.encodeSync('png'))
		// 		// fs.writeFileSync("./cetin3.pbf", im.getData());

		// 		// console.log('vector_tile: ', im.names(), im.toJSON());
		// 		// var json = im.toJSON();
		// 		// console.log('json.features');
		// 		// console.log(json[0].features);
			

		// 		console.timeEnd('CREATE RASTER');

		// 	});
		// });
	},





























	// convert CartoCSS to Mapnik XML
	cartoRenderer : function (css, layer, callback) {

		console.log('>>>>>>>>>>>>>>>>>> layer', layer);

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
			console.log('ERR 17'.red, e);
			
			var err = {
				message : e
			}
			callback(err);
		}


	},















	test : function (req, res) {
		console.log('TEST!!!');
		res.end(JSON.stringify({
			get : 'low'
		}));
	},


	getFile : function (req, res) {
		console.log('req.query', req.query);
		
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
			console.log('pile.request.get: ', err, results);
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

			console.log('params:=====>>>', params);


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
   	redis : config.kueRedis,
   	prefix : 'vq'
});

// #########################################
// ###  Redis for Layer Storage          ###
// #########################################
// configure redis for token auth
var redis = require('redis');
var layerStore = redis.createClient(config.tokenRedis.port, config.tokenRedis.host)
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
	jobs.process('vector_render', 10, function (job, done) {
		var file_id = job.data.file_id;
		var z = job.data.z;
		var x = job.data.x;
		var y = job.data.y;

		// create vector tile
		vile._createVectorTile(job.data, function (err) {
			// if (err) console.log('ERR 19'.red, err);
			done();
		});
		
	});


	// #########################################
	// ###  Kue jobs: Raster render          ###
	// #########################################
	// 'raster_render' job
	jobs.process('raster_render', 1000, function (job, done) {
		var fileUuid 	= job.data.fileUuid;
		var z 		= job.data.z;
		var x 		= job.data.x;
		var y 		= job.data.y;
		var cartoid 	= job.data.cartoid;

		// find vector tile and create raster tile
		vile.findVectorTile(fileUuid, z, x, y, function (vector_tile) {
			if (!vector_tile) return done();

			// create raster from vector_tile 			// callback
			vile.createRasterTile(vector_tile, fileUuid, cartoid, z, x, y, function (err, raster_tile) {
				if (err) console.log('ERR 20'.red, err);
				done && done();
			});
		});
	});





}


