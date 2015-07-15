// dependencies
var _ = require('lodash');
var fs = require('fs-extra');
var kue = require('kue');
var path = require('path');
var zlib = require('zlib');
var async = require('async');
var redis = require('redis');
var carto = require('carto');
var mapnik = require('mapnik');
var colors = require('colors');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var mapnikOmnivore = require('mapnik-omnivore');


// modules
var server = require('./server');
var config = require('./config/pile-config');

// register mapnik plugions
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();
mapnik.register_datasource(path.join(mapnik.settings.paths.input_plugins,'ogr.input'));

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


	test : function (req, res) {

		console.log('TEST!!!');

		res.end(JSON.stringify({
			get : 'low'
		}));

	},


	getFile : function (req, res) {

		console.log('req.query', req.query);
		
		var fileUuid = req.query.fileUuid,
		    ops = [];

		// check for missing info
		if (!fileUuid) return api.error.missingInformation(req, res);

		// todo: check permission to access file
		
		// get file
		File
		.findOne({uuid : fileUuid})
		.exec(function (err, file) {
			if (err) return api.error.general(req, res, err);

			res.end(JSON.stringify(file));
		});

	},
	

	// // entry point for /raster/*
	// requestRasterTile : function (req, res) {

	// 	// parse params
	// 	var params 	= req.url.split('/');
	// 	var fileUuid 	= params[2];
	// 	var cartoid 	= params[3];
	// 	var z 		= parseInt(params[4]); 
	// 	var x 		= parseInt(params[5]);
	// 	var last 	= params[6].split('.');
	// 	var y 		= parseInt(last[0]);
	// 	var ext 	= last[1];

	// 	// console.log('rasterTile', fileUuid, cartoid, z, x, y);

	// 	// async ops
	// 	var ops = [];

	// 	// OP: check for raster, serve  
	// 	ops.push(function (callback) {

	// 		vile.findRasterTile(fileUuid, cartoid, z, x, y, function (raster_tile) {
			
	// 			// if no raster, next op
	// 			if (!raster_tile) return callback(null);

	// 			// serve raster
	// 			res.set({'Content-Type': 'image/png' });
	// 			res.send(raster_tile);
	// 			res.end();

	// 			return callback({error : false});
			
	// 		});
	// 	});


	// 	// OP: check for vector
	// 	ops.push(function (callback) {

	// 		vile.findVectorTile(fileUuid, z, x, y, function (vector_tile) {

	// 			// if no vector, next op
	// 			if (!vector_tile) return callback(null);
				

	// 			// KUE: create raster tile
	// 			var job = jobs.create('raster_render', {
	// 				fileUuid : fileUuid, 
	// 				z : z, 
	// 				x : x, 
	// 				y : y,
	// 				// vector_tile : vector_tile,
	// 				cartoid : cartoid
	// 			}).priority('high').attempts(5).save();


	// 			// KUE DONE: raster created
	// 			job.on('complete', function (result) {

	// 				vile.findRasterTile(fileUuid, cartoid, z, x, y, function (raster_tile) {

	// 					// if no raster, weird!
	// 					if (!raster_tile) return callback(null);

	// 					// serve raster
	// 					res.set({'Content-Type': 'image/png' })
	// 					res.send(raster_tile);	
	// 					res.end();

	// 					return callback({error : false});
	// 				});
	// 			});
	// 		});
	// 	});
		

	// 	// OP: create vector tile
	// 	ops.push(function (callback) {


	// 		// no vector tile, so look for geojson above
	// 		// if no geojson above, grinder is not finished, serve waitingTile
	// 		// if geojson above, make vector tile from it

	// 		vile.findGeoJson(fileUuid, z, x, y, function (geojsonData, geojsonPath) {

				
	// 			// if no data and layer is a raster (eg. geotiff)
	// 			if (!geojsonData && cartoid == 'raster') { // todo: refactor! 

	// 				res.end();
	// 				return callback({error : false});

	// 			} else if (!geojsonData) {

	// 				vile.findProcessingTile(function (err, raster_tile) {

	// 					console.log('foundProcessinTile!', raster_tile);


	// 					// serve raster
	// 					res.set({'Content-Type': 'image/png' })
	// 					res.send(raster_tile);	
	// 					res.end();

	// 					return callback({error : false});
	// 				});

	// 			} else {

	// 				// create vector render job
	// 				var job = jobs.create('vector_render', {
	// 					geojsonPath : geojsonPath, 
	// 					fileUuid : fileUuid,
	// 					z : z, 
	// 					x : x, 
	// 					y : y
	// 				}).priority('high').attempts(5).save();

	// 				// KUE DONE: vector created
	// 				job.on('complete', function (result) {

	// 					// find vector tile
	// 					vile.findVectorTile(fileUuid, z, x, y, function (vector_tile) {

	// 						// create raster
	// 						vile.createRasterTile(vector_tile, fileUuid, cartoid, z, x, y, function (err, raster_tile) {
	// 							if (err) console.log('ERR 21'.red, err);

	// 							// catch err
	// 							if (err) return callback({error:true});

	// 							// serve raster
	// 							res.set({ 'Content-Type' : 'image/png' })
	// 							res.send(raster_tile);
	// 							res.end();
	// 							return callback({error:false});
	// 						});
	// 					});
	// 				});
	// 			};
	// 		});
	// 	});

	// 	// ASYNC SERIES: run ops
	// 	async.series(ops, function (err) {

	// 		// catch errors,
	// 		if (err.error) {
	// 			res.set({ 'Content-Type' : 'text/plain' });				// todo: create error tile
	// 			res.send('Error: No shape data to create vector tiles from!');
	// 			res.end();
	// 		} 
	// 	});
	// },



	//  // No vector tile found, look for nearest geojson file
 //        findGeoJson : function (fileUuid, z,x,y, callback) {

 //                // Get tile coordinates one up
 //                var tileAbove = vile.getTileAbove(z,x,y);

 //                if (!tileAbove) return callback(false);

 //                var z = tileAbove.z,
 //                    x = tileAbove.x,
 //                    y = tileAbove.y;

 //                vile.locateGeoJson(fileUuid, z, x, y, callback);
 //        },



 //        // Find nearest geojson file up
 //        locateGeoJson : function (fileUuid, z,x,y, callback) {

 //        	// geojson path
 //                var geojsonPath = VECTORPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.geojson';

 //                // read geojson (if exists)
 //                fs.readFile(geojsonPath, function (err, data) { // just check if exist instead of readfile

 //                	// got data
 //                	if (data && !err) return callback(data, geojsonPath);

	// 		// keep looking
	// 		vile.findGeoJson(fileUuid, z,x,y, callback);
 //                });
 //        },


 //        // Tile number one up
 //        getTileAbove : function  (fromZ, fromX, fromY) {

 //                // hit ceiling, no tile above
 //                if (fromZ <= 0) return false;

 //                // calc tile above
 //                var tileAbove = {
 //                        z : fromZ-1,
 //                        x : Math.floor(fromX/2),
 //                        y : Math.floor(fromY/2)
 //                }

 //                return (tileAbove);
 //        },


	// createVectorRenderJob : function (fileUuid, z, x, y) {

	// 	// KUE: create vector tile
	// 	var job = jobs.create('vector_render', {
	// 		fileUuid : fileUuid, 
	// 		z : z, 
	// 		x : x, 
	// 		y : y
	// 	}).priority('high').attempts(5).save();

	// 	return job;
	// },




	// requestUTFGrid : function (req, res) {
	// 	// return res.end(vile.emptyUTFGrid);

	// 	// set params
	// 	var params 	= req.url.split('/');
	// 	var fileUuid 	= params[2];
	// 	var z 		= parseInt(params[3]); 
	// 	var x 		= parseInt(params[4]);
	// 	var last 	= params[5].split('.');
	// 	var y 		= parseInt(last[0]);
	// 	var ext 	= last[1] + '.' + last[2];

	// 	var ops = [];


	// 	// console.log('requestUTFGrid'.red, z, x, y);

	// 	// ops.push(function (callback) {

	// 	// 	// find existing UTFGrid
	// 	// 	vile.findUTFGrid(fileUuid, z, x, y, function (utf) {

	// 	// 		// debug (nothing found, create)
	// 	// 		return callback(null);

	// 	// 		// do next op
	// 	// 		if (!utf) return callback(null);
				
	// 	// 		// return utf
	// 	// 		res.end(JSON.stringify(utf));
	// 	// 		return callback({error:false});
	// 	// 	});
	// 	// });


	// 	ops.push(function (callback) {

	// 		// get vector tile
	// 		vile.findVectorTile(fileUuid, z, x, y, function (vector_tile) {

	// 			// return if no vector tile
	// 			if (!vector_tile) return callback({error:true}); // was null

	// 			// create utf from vector tile
	// 			vile.createUTFGrid(vector_tile, fileUuid, z, x, y, function (utf) {

	// 				// if (!utf) return callback({error:true});
	// 				if (!utf) return callback({error:true});

	// 				// return utf;
	// 				res.end(utf);
	// 				return callback({error:false});
	// 			});
	// 		});
	// 	});

	// 	// OP: create vector tile
	// 	ops.push(function (callback) {

	// 		var job = vile.createVectorRenderJob(fileUuid, z, x, y);

	// 		// KUE DONE: vector created
	// 		job.on('complete', function (result) {

	// 			// find vector tile
	// 			vile.findVectorTile(fileUuid, z, x, y, function (vector_tile) {
	// 				if (!vector_tile) console.error('no vector tile created!?');
	// 				if (!vector_tile) return callback({error:true});
						
	// 				// create utf from vector tile
	// 				vile.createUTFGrid(vector_tile, fileUuid, z, x, y, function (utf) {

	// 					if (!utf) console.log('no utf');
	// 					if (!utf) return callback({error:true});

	// 					// return utf;
	// 					res.end(utf);
	// 					return callback({error:false});

	// 				});
	// 			});
	// 		});
	// 	});

	// 	async.series(ops, function (err) {
	// 		// catch errors
	// 		if (err.error) console.log('errrrr'.red, err);
	// 		if (err.error) res.end(vile.emptyUTFGrid);
	// 	});

	// },


	// findUTFGrid : function (fileUuid, z, x, y, callback) {
	// 	var path = UTFGRIDPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.grid.json';
	// 	fs.readJson(path, function (err, data) {
	// 		if (err) return callback(null);
	// 		callback(data);
	// 	});
	// },

	// findProcessingTile : function (callback) {

	// 	// debug: no processing file
	// 	return callback(null, null);

	// 	fs.readFile(config.processingTile, function (err, data) {
	// 		callback(null, data);
	// 	});
	// },


	// findRasterTile : function (fileUuid, cartoid, z, x, y, callback) {
	// 	var path = RASTERPATH + fileUuid + '/' + cartoid + '/' + z + '/' + x + '/' + y + '.png';

	// 	// console.log('checking path: ', path);
		
	// 	fs.readFile(path, function (err, data) {
	// 		if (err) return callback(null);
	// 		callback(data);
	// 	});
	// },

	// findVectorTile : function (fileUuid, z, x, y, callback) {
	// 	var path = VECTORPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.pbf';

	// 	fs.readFile(path, function (err, data) {
	// 		if (err) return callback(null)

	// 		// parse vtile
	// 		var vtile = new mapnik.VectorTile(z, x, y);
	// 		if (data.length) vtile.setData(data);
	// 		vtile.parse();	

	// 		return callback(vtile);
	// 	});
	// },

	// _getFields : function (vtile) {
	// 	var info = vtile.names();
	// 	var fields = [];
	// 	if (info.length) {
	// 		var gj = vtile.toGeoJSON(0);
	// 		if (!gj) return vile._doneFields(fields, gj);
	// 		var geo = JSON.parse(gj);
	// 		if (!geo.features) return vile._doneFields(fields, geo);
	// 		geo.features.forEach(function (p) {
	// 			for (p in p.properties) {
	// 				if (fields.indexOf(p) == -1) {
	// 					fields.push(p);		// properties in geojson
	// 				} 
	// 			}			
	// 		});
	// 	}
	// 	return fields;
	// },

	// _doneFields : function (fields, geo) {
	// 	return fields;
	// },

	// createUTFGrid : function (vtile, fileUuid, z, x, y, callback) {
	// 	var map = new mapnik.Map(256, 256);
	// 	var stylepath = config.defaultStylesheets.utfgrid; // todo?
	// 	map.loadSync(stylepath);
	// 	map.extent = [-20037508.34, -20037508.34, 20037508.34, 20037508.34];


	// 	// console.log('creating grid tile'.yellow, z, x, y);

	// 	// get fields of geojson
	// 	var fields = vile._getFields(vtile);

	// 	var grid = new mapnik.Grid(256, 256);

	// 	var options = {
	// 		layer : 0,
	// 		fields : fields,
	// 		buffer_size : 64
	// 	}

	// 	vtile.render(map, grid, options, function(err, vtile_utfgrid) {
	// 		if (err) { 
	// 			if (err) console.log('ERR 27'.red, err);
	// 			return callback(err);
	// 		}

	// 		vtile_utfgrid.encode({features : true}, function (err, utf) {
	// 			if (err) console.log('ERR 28'.red, err);

	// 			if (!utf) {
	// 				console.log('ERR 30'.yellow, err);
	// 			}

	// 			// set paths and stringify
	// 			var folder = UTFGRIDPATH + fileUuid + '/' + z + '/' + x + '/';
	// 			var utfgrid_path = folder + y + '.grid.json';
	// 			var utf = JSON.stringify(utf,null,1);
				
	// 			if (utf.length == 4529) {
	// 				// console.log('empty utf!'.red, z, x, y);
	// 				// console.log(vtile.names());
	// 			}

	// 			// write to disk
	// 			fs.outputFile(utfgrid_path, utf, function(err) {
	// 				if (err) console.log('ERR 29'.red, err);
	// 				// callback with utf
	// 				// console.log('grid tile success'.yellow, z, x, y);
	// 				callback(utf); 
	// 			});
	// 		});
	// 	});
			
	// },



	// createRasterTile : function (vtile, fileUuid, cartoid, z, x, y, callback) {

	// 	var defaultstyle = false;

	// 	var map = new mapnik.Map(vtile.width(), vtile.height());	// 256, 256
		

	// 	if (cartoid == 'cartoid') {
	// 		var stylepath = config.defaultStylesheets.raster;
	// 		map.loadSync(stylepath);
	// 	} else {
	// 		try {
	// 			// will throw error if stylesheet not found (or invalid, or empty);
	// 			var stylepath = STYLEPATH + cartoid + '.xml';
	// 			map.loadSync(stylepath);
	// 		} catch (e) { 
	// 			var stylepath = config.defaultStylesheets.raster;
	// 			map.loadSync(stylepath);
	// 		}
	// 	}

	// 	var base = 18;
	// 	var baseX = 4;
	// 	var ratio = 0.5;

	// 	// console.log('sTYELPAYT', stylepath);
		
	// 	// get variables if exists
	// 	var inVariablesPath = VECTORPATH + fileUuid + '/' + 'variables.json';
	// 	console.log('VARIABLES PATH:', inVariablesPath);
	// 	fs.readJson(inVariablesPath, function (err, metadata) {
	// 		if (err) console.log('read vars err', err);
	// 		// console.log('metadata: ', metadata);
	// 		// console.log('typeof', typeof(metadata));
		
	// 		var options = {
	// 			buffer_size : 10,
	// 		};

	// 		if (metadata) {
	// 			metadata.loko = 135;

	// 			// for (var key in metadata) {
	// 			// 	console.log('key type=>', key,  typeof(metadata[key]));
	// 			// }

	// 			options.variables = metadata;

	// 		}

	// 		// console.log('@options: ', options);

	// 		// console.time('Rendered Raster Tile');
	// 		vtile.render(map, new mapnik.Image(256,256), options, function(err, raster_tile) {
	// 		// vtile.render(map, new mapnik.Image(1024,1024), options, function(err, raster_tile) {
	// 			if (err) console.log('ERR 8'.red, err);

	// 			var folder = RASTERPATH + fileUuid + '/' + cartoid + '/' + z + '/' + x + '/';

	// 			fs.ensureDir(folder, function (err) {
	// 				if (err) console.log('ERR 6'.red, err);

	// 				var raster_path = folder + y + '.png';
	// 				raster_tile.save(raster_path, 'png32');  

	// 				fs.readFile(raster_path, function(err, raster_image) {
	// 					if (err) console.log('ERR 7'.red, err);
						
	// 					callback(err, raster_image); 
	// 				});
	// 			});
	// 		});

	// 	});

	// },


	// // create vector tile from geojson
	// createVectorTile : function (fileUuid, z, x, y, done) {

	// 	console.log('createVectorTile!');

	// 	var geopath = GEOJSONPATH + fileUuid + '.geojson';

	// 	var ops = [],
	// 	outside,
	// 	extent;

	// 	// console.log('.'.yellow);

	// 	ops.push(function (callback) {

	// 		// get meta
	// 		console.log('getmeta');
	// 		vile.getMeta(fileUuid, function (err, metadata) {
	// 			if (err) console.log('ERR 1'.red, err);

	// 			// console.log('got meta', metadata);

	// 			// if tile is outside extent of geojson, create empty vector tile
	// 			if (metadata) {
	// 				extent = metadata.extent;
	// 				var coords = vile.getTilecoords(z, x, y);
	// 				outside = vile.getOutside(coords, extent, z);

	// 			} else {
	// 				outside = false;
	// 			}

	// 			callback(null);
	// 		});
	// 	});



	// 	if (outside) {

	// 		// create empty vector tile
	// 		ops.push(function (callback) {

	// 			console.log('empty!'.red);

	// 			vile._createEmptyVectorTile({
	// 				fileUuid : fileUuid, 
	// 				z : z,
	// 				x : x,
	// 				y : y
	// 			}, callback);

	// 			// // create objects
	// 			// var map = new mapnik.Map(256, 256);
	// 			// var vtile = new mapnik.VectorTile(z, x, y);

	// 			// // render to pbf
	// 			// map.render(vtile, {}, function (err, vtile) {
	// 			// 	if (err) console.log('ERR 3'.red, err);

	// 			// 	var vector_path = VECTORPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.pbf';

	// 			// 	// write pbf to disk
	// 			// 	fs.outputFile(vector_path, vtile.getData(), function (err) {
	// 			// 		if (err) console.log('ERR 2'.red, err);
	// 			// 		callback('done created empty'); // pass err, cancel async
	// 			// 	});
	// 			// });
	// 		});


	// 	} else {

	// 		console.log('inside');

	// 		// create vector tile from geojson
	// 		ops.push(function (callback) {

	// 			fs.readFile(geopath, function (err, data) {
	// 				if (err) console.log('ERR 4'.red, err);
	// 				if (err) console.log('ERR 4'.red, err);

	// 				// console.log('raed source:', geopath);

	// 				if (err) return callback(err);

	// 				if (!data) return callback('No data!');
					
	// 				var d = data.toString();

	// 				// create tile
	// 				var vtile = new mapnik.VectorTile(z, x, y);


	// 				// patch, err on double \\"\\" geojson
	// 				try {
	// 					vtile.addGeoJSON(d, 'layer');
	// 				} catch (e) {

	// 					// console.log('empty!2');
	// 					// create empty tile, todo: try parsing geojson file, regex \\"" qoutes
	// 					vile._createEmptyVectorTile({
	// 						fileUuid : fileUuid, 
	// 						z : z,
	// 						x : x,
	// 						y : y
	// 					}, callback);


	// 					return;
	// 				}

					

	// 				var vector_path = VECTORPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.pbf';

	// 				// vtile.parse(function (err, parsed_vtile) {
	// 				// 	console.log('#$$$$$$$$$$$$ parsed'.yellow);
	// 				// 	console.log('err, parsed_tile', err, parsed_vtile);
					

	// 				// console.log('writing t222 you !');
						
	// 				// });


	// 				// write pbf to disk
	// 				fs.outputFile(vector_path, vtile.getData(), function (err) {
	// 					if (err) console.log('ERR 5'.red, err);
	// 					// console.log('wrote pfd to disk!'.magenta, fileUuid, z, x, y);
	// 					callback('done 4created with data');
	// 				});

	// 			});
	// 		});
	// 	};

	// 	async.series(ops, function (err) {
	// 		done();
	// 	});

	// },


	// _createVectorTile : function (options, callback) {
	// 	var fileUuid = options.fileUuid,
	// 	    geojsonPath = options.geojsonPath,
	// 	    data = options.data,
	// 	    z = options.z,
	// 	    x = options.x, 
	// 	    y = options.y;


	// 	// path
	// 	var vector_path = VECTORPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.pbf';


	// 	fs.readFile(geojsonPath, function (err, data) {
	// 		// if (err) console.log('brickinthewall'.yellow, err);
	// 		if (err) return callback(null)
	// 		// if (!data) return callback(null);

	// 		// // parse vtile
	// 		// var vtile = new mapnik.VectorTile(z, x, y);
	// 		// if (data.length) vtile.setData(data);
	// 		// vtile.parse();	

			
	// 		var vtile = new mapnik.VectorTile(z, x, y);

	// 		// add data
	// 		vtile.addGeoJSON(data.toString(), 'layer');


	// 		// write pbf to disk
	// 		fs.outputFile(vector_path, vtile.getData(), function (err) {
	// 			if (err) console.log('ERR 5'.red, err);
				
	// 			// console.log('wrote !!pfd to disk!'.magenta, fileUuid, z, x, y);
				
	// 			// done
	// 			callback('done created with data1');
	// 		});
	// 	});


	// 	// // create objects
	// 	// var map = new mapnik.Map(256, 256);
	// 	// var vtile = new mapnik.VectorTile(z, x, y);

	// 	// // add data
	// 	// vtile.addGeoJSON(data, 'layer');

	// 	// // write pbf to disk
	// 	// fs.outputFile(vector_path, vtile.getData(), function (err) {
	// 	// 	if (err) console.log('ERR 5'.red, err);
			
	// 	// 	console.log('wrote pfd to disk!'.magenta, fileUuid, z, x, y);
			
	// 	// 	// done
	// 	// 	callback('done created with data');
	// 	// });

	// },



	// _storedGeoJSON : {

	// },


	// _createEmptyVectorTile : function (options, callback) {
	// 	var fileUuid = options.fileUuid,
	// 	    z = options.z,
	// 	    x = options.x, 
	// 	    y = options.y; 

	// 	// console.log('_createEmptyVectorTile');

	// 	// create objects
	// 	var map = new mapnik.Map(256, 256);
	// 	var vtile = new mapnik.VectorTile(z, x, y);

	// 	// render to pbf
	// 	map.render(vtile, {}, function (err, vtile) {
	// 		if (err) console.log('ERR 3'.red, err);

	// 		var vector_path = VECTORPATH + fileUuid + '/' + z + '/' + x + '/' + y + '.pbf';

	// 		// write pbf to disk
	// 		fs.outputFile(vector_path, vtile.getData(), function (err) {
	// 			if (err) console.log('ERR 2'.red, err);
	// 			callback('done created empty'); // pass err, cancel async
	// 		});
	// 	});
	// },



	// // just save to disk
	// importGeojson : function (req, res) {

	// 	// gunzip
	// 	var buffer = new Buffer(req.body);
	// 	zlib.gunzip(buffer, function(err, decoded) {
	// 		if (err) console.log('ERR 10'.red, err);
	// 		if (err) return res.end('Zlib error');

	// 		// parse, get vars
	// 		var pack 	= JSON.parse(decoded.toString());
	// 		var geojson 	= JSON.stringify(pack.geojson);
	// 		var layerName 	= pack.layerName;
	// 		var uuid 	= pack.uuid;
	// 		var ext 	= '.pbf';
	// 		var path 	= VECTORPATH + uuid + ext;
	// 		var folder 	= uuid + '/';
	// 		var geojsonPath = GEOJSONPATH + uuid + '.geojson';

	// 		// write to file
	// 		fs.outputFile(geojsonPath, geojson, function (err) {
	// 			if (err) console.log('ERR 11'.red, err);

	// 			// save meta to file
	// 			vile.setMeta(uuid, function (err, metadata) {
	// 				if (err) console.log('ERR 12'.red, err);
					
	// 				// return				// todo: start vector tiling
	// 				res.end(JSON.stringify(metadata));

	// 			});
	// 		});
	// 	});
	// },


	// getMeta : function (uuid, callback) {

	// 	var omnipath = METAPATH + uuid + '.meta.json';
	// 	fs.readJson(omnipath, function (err, metadata) {

	// 		console.log('METADATAAAA', metadata);

	// 		// return metadata
	// 		if (!err) return callback(null, metadata);

	// 		// not exist, create and return metadata
	// 		return vile.setMeta(uuid, callback);
		
	// 	});

	// },


	// setMeta : function (uuid, callback) {

	// 	var geopath = GEOJSONPATH + uuid + '.geojson';
	// 	var omnipath = METAPATH + uuid + '.meta.json';

	// 	mapnikOmnivore.digest(geopath, function(err, metadata){	
	// 		if (err) console.log('ERR 14'.red, err);

	// 		console.log('ominvore!', metadata);

	// 		fs.outputFile(omnipath, JSON.stringify(metadata), function (err) {		
	// 			if (err) console.log('ERR 15'.red, err);

	// 			// return meta
	// 			if (callback) callback(err, metadata);
	// 		});
	// 	});
	// },



	// importCartoCSS : function (req, res) {

	// 	var css 	= req.body.css;
	// 	var cartoid 	= req.body.cartoid;
	// 	var osm 	= req.body.osm;

	// 	console.log('importCartoCSS', cartoid);

		
	// 	vile.mss2xml(css, cartoid, function (err) {
	// 		if (err) {
	// 			if (err) console.log('ERR 16'.yellow, err); 	// syntax errors trigger here.

	// 			var result = JSON.stringify({
	// 				ok : false,
	// 				error : err.message.toString()
	// 			});

	// 			// return err
	// 			return res.end(result);

	// 		}

	// 		// return ok
	// 		res.end(JSON.stringify({
	// 			ok : true,
	// 			error : null
	// 		}));
	// 	});
		
	// },


	// mss2xml : function (css, cartoid, callback) {

	// 	var options = {
	// 		"srs": "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over",



	// 		"Stylesheet": [{
	// 			"id" : cartoid,
	// 			"data" : css
	// 		}],
	// 		"Layer": [{
	// 			"id" : "layer",	
	// 			"name" : "layer"
	// 		}]
	// 	}

	// 	try  {

	// 		// carto renderer
	// 		var cr = new carto.Renderer({
	// 			filename: cartoid + '.mss',
	// 			local_data_dir: CARTOCSSPATH,
	// 		});

	// 		// get xml from 
	// 		var xml = cr.render(options);
	// 		var stylepath = STYLEPATH + cartoid + '.xml';
	// 		// var stylepath = config.defaultStylesheets.raster;

	// 		fs.outputFile(stylepath, xml, function (err) {
	// 			if (err) console.log('ERR 16'.red, err);

	// 			callback(err);
	// 		});

	// 	} catch (e) {
	// 		console.log('ERR 17'.red, e);
			
	// 		var err = {
	// 			message : e
	// 		}
	// 		callback(err);
	// 	}


	// },


	// getTilecoords : function (zoom, xtile, ytile) {
	// 	var n = Math.pow(2, zoom);
	// 	var lon_deg = xtile / n * 360.0 - 180.0
	// 	var lat_rad = Math.atan(vile.sinh(Math.PI * (1 - 2 * ytile / n)))
	// 	var lat_deg = lat_rad * 180.0 / Math.PI;
	// 	return [lat_deg, lon_deg];

	// 	// n = 2 ^ zoom
	// 	// lon_deg = xtile / n * 360.0 - 180.0
	// 	// lat_rad = arctan(sinh(π * (1 - 2 * ytile / n)))
	// 	// lat_deg = lat_rad * 180.0 / π
	// 	// http://wiki.openstreetmap.org/wiki/Tilenames
	// },



	// sinh : function (aValue) {
	// 	var myTerm1 = Math.pow(Math.E, aValue);
	// 	var myTerm2 = Math.pow(Math.E, -aValue);
	// 	return (myTerm1-myTerm2)/2;
	// },

	// getCoords : function (z, x, y) {
	// 	var lat = vile.tile2lat(y,z);
	// 	var lng = vile.tile2long(x,z);
	// 	return [lat, lng];
	// },

	// tile2lat : function (y,z) { 
	// 	var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
	// 	return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))); 
	// },

	// tile2long : function (x,z) { 
	// 	return (x/Math.pow(2,z)*360-180); 
	// },

	// getOutside : function (coords, extent, zoom) {

	// 	var fx = 1/zoom;  // eg zoom 14, factor - 1/14.. zoom = 2, fx = 1/2 ...
		
	// 	// at zoom 7, we want 2.5 degrees extra
	// 	// at zoom 6, we want 5 degrees extra 		80 / 6
	// 	// at zoom 5, we want 10 degrees extra
	// 	// at zoom 4, we want 20 			80 / 4
	// 	// at zoom 3, we want 30 degrees extra 		
	// 	// at zoom 2, we want 40 degrees extra 		80 / 2
	// 	// at zoom 1, we want 80 degrees extra 		80 / 1
		
	// 	// todo: calc
	// 	var trans = {

	// 		1 : 80,  // 
	// 		2 : 40,  // x = zoom, y = degrees
	// 		3 : 30,  
	// 		4 : 20,
	// 		5 : 10,
	// 		6 : 5,
	// 		7 : 2.5,
	// 		8 : 1.25,
	// 		9 : 0.625,
	// 		10 : 0.4,
	// 		11 : 0.2,
	// 		12 : 0.1,
	// 		13 : 0.05,
	// 		14 : 0.025,
	// 		15 : 0.0125,
	// 		16 : 0.0625,
	// 		17 : 0.004,
	// 		18 : 0.002,
	// 		19 : 0.002,
	// 		20 : 0.001,
	// 		21 : 0.001,
	// 		22 : 0.001
	// 	}



	// 	var extra = trans[zoom];


	// 	// extra degress  
	// 	var extra = fx * 100; // at zoom 2, gives 50 degrees

	// 	var c = {
	// 		lat : coords[0],
	// 		lng : coords[1]  // padding
	// 	}

	// 	var e = {
	// 		lat1 : extent[1] - extra, 	// south border
	// 		lng1 : extent[0] - extra, 	// west border
	// 		lat2 : extent[3] + extra, 	// north border
	// 		lng2 : extent[2] + extra 	// east border
	// 	}


	// 	var a,b;

	// 	if (c.lat > e.lat1 && c.lat < e.lat2) {
	// 		// inside extent
	// 		a = true;
	// 		// console.log('a = true');
	// 	}

	// 	if (c.lng > e.lng1 && c.lng < e.lng2) {
	// 		// inside extent
	// 		b = true;
	// 		// console.log('b = true');
	// 	}

	// 	if (a && b) return false;
	// 	return true;

	// },


	// // empty grid to avoid 502 misinterpretation
	// emptyUTFGrid : JSON.stringify({
	// 	"grid": [
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                ",
	// 		"                                                                "
	// 	],
		
	// 	"keys": [
	// 		""
	// 	],
		
	// 	"data": {}
		
	// 	}, null, 1)

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
		var fileUuid = job.data.fileUuid;
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


