// dependencies
var _ = require('lodash');
var pg = require('pg');
var gm = require('gm');
var fs = require('fs-extra');
var kue = require('kue');
var path = require('path');
var zlib = require('zlib');
var uuid = require('uuid');
var async = require('async');
var redis = require('redis');
var carto = require('carto');
var crypto = require('crypto');
var mapnik = require('mapnik');
var colors = require('colors');
var cluster = require('cluster');
var mongoose = require('mongoose');
var request = require('request');
var numCPUs = require('os').cpus().length;
var exec = require('child_process').exec;
var sanitize = require("sanitize-filename");
var mercator = require('./sphericalmercator');
var geojsonArea = require('geojson-area');
var geojsonExtent = require('geojson-extent');
var topojson = require('topojson');


// modules
var config = require(process.env.PILE_CONFIG_PATH || '../../config/pile-config');
var store  = require('./store');
var tools = require('./tools');

// register mapnik plugins
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();

// global paths (todo: move to config)
var VECTORPATH = '/data/vector_tiles/';
var RASTERPATH = '/data/raster_tiles/';
var CUBEPATH   = '/data/cube_tiles/';
var GRIDPATH   = '/data/grid_tiles/';
var PROXYPATH  = '/data/proxy_tiles/';

// postgis conn
var pgsql_options = {
    dbhost: 'postgis',
    dbuser: process.env.SYSTEMAPIC_PGSQL_USERNAME || 'docker',
    dbpass: process.env.SYSTEMAPIC_PGSQL_PASSWORD || 'docker'
};

module.exports = cubes = { 

    create : function (req, res) {
        var options = req.body;

        // default cube options
        var defaultOptions = {
            cube_id : 'cube-' + uuid.v4(),
            timestamp : new Date().getTime(),
            createdBy : req.user.uuid,
            style : options.style || '#layer { raster-opacity: 1; }',
            quality : options.quality || 'png32',
            datasets : _.isArray(options.datasets) ? options.datasets : [] // ensure array
        };

        // combine options (latter overrides former)
        var cube = _.extend(options, defaultOptions);

        // save cube
        cubes.save(cube, function (err) {
            if (err) return res.status(400).send(err);

            // return cube
            res.send(cube);
        });
    },

    get : function (req, res) {
        
        // get options
        var options = cubes.getBody(req);
        if (!options) return res.status(400).send({error : 'Please provide a dataset id'})
        
        // get uuid
        var cube_id = options.cube_id;
        if (!cube_id) return res.status(400).send({error : 'Please provide a dataset id'})

        // get cube
        cubes.find(cube_id, function (err, cube) {
            if (err) return res.status(400).send({error : 'No such cube_id'}) 
            res.send(cube);
        });
    },

    add : function (req, res) {

        // get options
        var options = cubes.getBody(req);
        if (!options) return res.status(400).send({error : 'Please provide a dataset id', error_code : 1});

        // get cube_id
        var cube_id = options.cube_id;
        if (!cube_id) return res.status(400).send({error : 'Please provide a dataset id', error_code : 2});

        // get datasets
        var datasets = options.datasets;
        if (!datasets.length) return res.status(400).send({error : 'Please provide datasets', error_code : 3});

        // todo: verify correct format of datasets. add test.

        var ops = [];

        // get cube
        ops.push(function (callback) {
            cubes.find(cube_id, callback);
        });

        ops.push(function (cube, callback) {

            // add datasets to array
            datasets.forEach(function (d) {
                cube.datasets.push(d);
            });

            // save
            cubes.save(cube, callback);
        });
           
        // run ops
        async.waterfall(ops, function (err, updated_cube) {
            if (err) return res.status(400).send({error : err.message}) 

            // return updated cube
            res.send(updated_cube);
        });
    },

    remove : function (req, res) {

        // get options
        var options = cubes.getBody(req);
        if (!options) return res.status(400).send({error : 'Please provide a dataset id', error_code : 1});

        // get cube_id
        var cube_id = options.cube_id;
        if (!cube_id) return res.status(400).send({error : 'Please provide a dataset id', error_code : 2});

        // get datasets
        var datasets = options.datasets;
        if (!datasets.length) return res.status(400).send({error : 'Please provide a dataset id', error_code : 3});

        var ops = [];

        // get cube
        ops.push(function (callback) {
            cubes.find(cube_id, callback);
        });

        ops.push(function (cube, callback) {

            // remove datasets from array
            datasets.forEach(function (d) {
                _.remove(cube.datasets, {id : d.id});
            });

            // save
            cubes.save(cube, callback);
        });
           
        // run ops
        async.waterfall(ops, function (err, updated_cube) {
            if (err) return res.status(400).send({error : err.message}) 

            // return updated cube
            res.send(updated_cube);
        });
    },

    update : function (req, res) {

        // get options
        var options = cubes.getBody(req);
        if (!options) return res.status(400).send({error : 'Please provide a dataset id', error_code : 1});

        // get cube_id
        var cube_id = options.cube_id;
        if (!cube_id) return res.status(400).send({error : 'Please provide a dataset id', error_code : 2});

        var ops = [];

        // remove access token
        delete options.access_token;

        // get cube
        ops.push(function (callback) {
            cubes.find(cube_id, callback);
        });

        // update cube
        ops.push(function (cube, callback) {

            // add options to existing cube
            var updated_cube = _.extend(cube, options);

            // update timestamp
            updated_cube.timestamp = new Date().getTime();

            // save
            cubes.save(updated_cube, callback);
        });
           
        // run ops
        async.waterfall(ops, function (err, updated_cube) {
            if (err) return res.status(400).send({error : err.message}) 

            // return updated cube
            res.send(updated_cube);
        });
    },

    mask : function (req, res) {

        // get options
        var options = cubes.getBody(req);
        if (!options) return res.status(400).send({error : 'Please provide an options object', error_code : 2});

        // get mask
        var mask = options.mask;
        if (!mask) return res.status(400).send({error : 'Please provide a mask', error_code : 2});

        // get cube_id
        var cube_id = options.cube_id;
        if (!cube_id) return res.status(400).send({error : 'Please provide a dataset id', error_code : 2});

        // get access token
        var access_token = options.access_token;

        var ops = {};

        console.log('mask', options);

        // get cube
        ops.cube = function (callback) {
            cubes.find(cube_id, callback);
        };


        // geojson string
        if (mask.type == 'geojson') {

            // convert geojson to topojson
            ops.topo = function (callback) {

                // parse geojson string
                var collection = tools.safeParse(mask.mask);

                // throw on failed parsing
                if (!collection) return callback({error : 'Invalid GeoJSON', error_code : 3});

                // convert
                var topology = topojson.topology({collection: collection});

                // return topojson
                callback(null, topology);
            };
           

        // topojson string
        } else if (mask.type == 'topojson') {

            // convert geojson to topojson
            ops.topo = function (callback) {

                // return topojson
                var topology = mask.mask;

                // throw on failed parsing
                if (!topology) return callback({error : 'Invalid GeoJSON', error_code : 3});

                // return topology
                callback(null, topology);
            };


        // mask from existing dataset
        } else if (mask.type == 'dataset') {

            // convert geojson to topojson
            ops.topo = function (callback) {

                // get dataset id
                var dataset_id = mask.mask;

                // sanity check dataset_id
                if (!_.isString(dataset_id) || _.size(dataset_id) < 20 || _.size(dataset_id) > 30) {
                    return callback({error : 'Invalid dataset_id', error_code : 3});
                }

                // get dataset as geojson from API
                var url = 'http://wu:3001/v2/data/geojson?dataset_id=' + dataset_id + '&access_token=' + access_token;
                request(url, function (error, response, body) {
                    if (!response || error) return callback({error : 'Unauthorized', error_code : 3});

                    // parse
                    var collection = tools.safeParse(body);

                    // verify
                    if (!collection) return callback({errir : 'Invalid GeoJSON', error_code : 5});

                    // convert to topojson
                    var topology = topojson.topology({collection: collection});

                    // return topojson
                    callback(null, topology);

                });
            };

        
        // throw on non-supported mask types
        } else {
            ops.topo = function (callback) {
                callback({error : 'Mask type ' + mask.type + ' is not supported!', error_code : 3})
            };
        }


        async.series(ops, function (err, result) {
            if (err) return res.status(400).send(err);

            // get mask, cube
            var topology = result.topo;
            var cube = result.cube;

            // add mask to cube
            var updated_cube = _.extend(cube, {
                mask : topology,
                timestamp : new Date().getTime()
            });

            // save
            cubes.save(updated_cube, function (err, updated_cube) {
                if (err) return res.status(400).send({error : 'Failed to save Cube. Error: ' + err.message, error_code : 5});

                // return updated cube
                res.send(updated_cube);
            });

        });

    },

    unmask : function (req, res) {
        
        // get options
        var options = cubes.getBody(req);
        if (!options) return res.status(400).send({error : 'Please provide an options object', error_code : 2});

        // get cube_id
        var cube_id = options.cube_id;
        if (!cube_id) return res.status(400).send({error : 'Please provide a dataset id', error_code : 2});

        var ops = {};

        cubes.find(cube_id, function (err, cube) {

            // delete mask
            delete cube.mask;
 
            // save
            cubes.save(cube, function (err, updated_cube) {
                if (err) return res.status(400).send({error : 'Failed to save Cube. Error: ' + err.message, error_code : 5});

                // return updated cube
                res.send(updated_cube);
            });
        });

    },

    // cube tile requests
    tile : function (req, res) {

        // get options
        var options = cubes.getBody(req);
        var access_token = req.query.access_token;
        var cube_request = cubes.getCubeRequest(req);
        var ops = {};

        // return if erroneus request
        if (!cube_request) return pile.serveErrorTile(res);

        // find dataset
        ops.dataset = function (callback) {
            pile.getUploadStatus({
                file_id : cube_request.dataset,
                access_token : access_token
            }, callback);
        };

        // find cube
        ops.cube = function (callback) {
            cubes.find(cube_request.cube_id, callback);
        };

        // run ops
        async.parallel(ops, function (err, results) {
            if (err) return res.status(400).end(err.message);

            // get cube, dataset
            var cube = results.cube;
            var dataset = results.dataset;

            // return on error
            if (!cube || !dataset || dataset.error) return pile.serveErrorTile(res);

            // serve tile
            cubes._serveTile({
                cube : cube,
                dataset : dataset,
                cube_request : cube_request
            }, res);
        
        });
    },


    _serveTile : function (options, res) {

        // get options
        var cube = options.cube;
        var dataset = options.dataset;
        var cube_request = options.cube_request;

        // check if tile is outside bounds if dataset
        var out_of_bounds = cubes._isOutsideExtent(options);

        if (out_of_bounds) {
            console.log('Serving empty tile (outside extent)')
            return pile.serveEmptyTile(res);
        }

        // create unique hash for style
        var style_hash = crypto.createHash('md5').update(cube.style).digest("hex");
        
        // define path
        var keyString = 'cube_tile:' + cube.cube_id + ':' + dataset.file_id + ':' + style_hash + ':' + cube_request.z + ':' + cube_request.x + ':' + cube_request.y + '.png';
        var tilePath = CUBEPATH + keyString;

        // check for cached tile
        fs.readFile(tilePath, function (err, tile_buffer) {
            if (!err && tile_buffer) {

                // return cached tile
                console.log('Serving cached tile');
                res.writeHead(200, {'Content-Type': pile.headers['png']});
                res.end(tile_buffer);

            } else {

                // create new tile
                cubes._createTileRenderJob({
                    tilePath : tilePath,
                    dataset : dataset,
                    cube : cube,
                    coords : {                                
                        z : cube_request.z,
                        x : cube_request.x,
                        y : cube_request.y
                    }, 
                }, res);
            }
        });

    },

    _createTileRenderJob : function (options, res) {

        // create tile job
        var job = pile.jobs().create('cube_tile', { 
            options : options,
        }).priority('high').attempts(5).save();

        // cubes tile job done
        job.on('complete', function (result) {

            // serve cube tile
            cubes.serveTile(res, options.tilePath);
        });
    },

    serveTile : function (res, tilePath) {
        // read from disk
        fs.readFile(tilePath, function (err, tile_buffer) {
            res.writeHead(200, {'Content-Type': pile.headers['png']});
            res.end(tile_buffer);
        });
    },

    _isOutsideExtent : function (options) {
        
        try {

        // get options
        var dataset = options.dataset;
        var coords = options.cube_request;
        var metadata = dataset.metadata;
        var metadata = tools.safeParse(dataset.metadata);

        // get extents
        var extent_geojson = metadata.extent_geojson;
        var bounding_box = mercator.xyz_to_envelope(parseInt(coords.x), parseInt(coords.y), parseInt(coords.z), false);
        var raster_extent_latlng = geojsonExtent(extent_geojson);
        var south_west_corner = Conv.ll2m(raster_extent_latlng[0], raster_extent_latlng[1]);
        var north_east_corner = Conv.ll2m(raster_extent_latlng[2], raster_extent_latlng[3]);

        // tile is outside raster bounds if:
        // - - - - - - - - - - - - - - - - - 
        // tile-north is south of raster-south  (tile_north < raster_south)
        // OR
        // tile-east is west of raster-west     (tile-east  < raster-west)
        // OR
        // tile-south is north of raster-north  (tile-south > raster-north)
        // OR
        // tile-west is east of raster-east,    (tile-west  > raster-east)
        
        var raster_bounds = {
            west    : south_west_corner.x,
            south   : south_west_corner.y,
            east    : north_east_corner.x,
            north   : north_east_corner.y
        };

        var tile_bounds = {
            west    : bounding_box[0],
            south   : bounding_box[1],
            east    : bounding_box[2],
            north   : bounding_box[3]
        };

        // check if outside extent
        var outside = false;
        if (tile_bounds.north < raster_bounds.south)    outside = true;
        if (tile_bounds.east < raster_bounds.west)      outside = true;
        if (tile_bounds.south > raster_bounds.north)    outside = true;
        if (tile_bounds.west > raster_bounds.east)      outside = true;

        } catch (e) {
            var outside = false;    
        }

        return outside;
    },

    createTile : function (options, done) {
        var dataset = options.dataset;
        var cube = options.cube;
        var coords = options.coords;
        var tilePath = options.tilePath;
        var map;
        var layer;
        var postgis;
        var bbox;
        var ops = [];

    
        // define settings, xml
        ops.push(function (callback) {

            var pgsql_options = {
                dbhost: 'postgis',
                dbuser: process.env.SYSTEMAPIC_PGSQL_USERNAME || 'docker',
                dbpass: process.env.SYSTEMAPIC_PGSQL_PASSWORD || 'docker'
            };

            // default settings
            var default_postgis_settings = {
                user     : pgsql_options.dbuser,
                password : pgsql_options.dbpass,
                host     : pgsql_options.dbhost,
                srid     : '3857'
            }

            // set bounding box
            bbox = mercator.xyz_to_envelope(parseInt(coords.x), parseInt(coords.y), parseInt(coords.z), false);

            // insert layer settings 
            var postgis_settings = default_postgis_settings;
            postgis_settings.dbname = dataset.database_name;
            postgis_settings.asynchronous_request = true;
            postgis_settings.max_async_connection = 10;
            postgis_settings.geometry_field = 'rast';
            postgis_settings.table = dataset.table_name;
            postgis_settings.band = 1;
            postgis_settings.type = 'pgraster';
            postgis_settings.use_overviews = 'true';
            postgis_settings.clip_rasters = 'true';
            postgis_settings.prescale_rasters = 'true';

            try {   
                map     = new mapnik.Map(256, 256, mercator.proj4);
                layer   = new mapnik.Layer('layer', mercator.proj4);
                postgis = new mapnik.Datasource(postgis_settings);
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

            // continue
            callback(null, layer);
        });

        ops.push(function (layer, callback) {

            var css = cube.style;

            if (!css) {
                console.error( 'cartoRenderer called with undefined or empty css' );
                css = "#layer {}";
            }

            var options = {
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

        });

        // load xml to map
        ops.push(function (xml, callback) {
            map.fromString(xml, {strict : true}, callback);
        });

        ops.push(function (map, callback) {

            // debug write xml
            if (0) pile._debugXML(cube.cube_id, map.toXML());

            // map options
            var map_options = {
                buffer_size : 128,
            }
            
            // raster
            var im = new mapnik.Image(256, 256);

            // render
            map.render(im, map_options, callback);

        });

        ops.push(function (tile, callback) {

            // save to disk
            tile.encode(cube.quality || 'png8', function (err, buffer) {
                fs.outputFile(tilePath, buffer, function (err) {
                    callback(null, tilePath);
                });
            });
        });

        // run ops
        console.time('create cube tile');
        async.waterfall(ops, function (err, tilePath) {
            console.timeEnd('create cube tile');
            done(err, tilePath);
        });
    },



    query : function (req, res) {
        var options = req.body;
        var access_token = options.access_token;
        var cube_id = options.cube_id;
        var geometry = options.geometry;
        var query_type = options.query_type;
        var ops = [];

        console.log('req.body', req.body);

        // create geojson from geometry
        var geojson = cubes.geojsonFromGeometry(geometry);

        // console.log('cube_id, geom', cube_id, geometry, query_type);

        ops.push(function (callback) {
            console.log('looking@!');
            cubes.find(cube_id, function (err, cube) {
                console.log('looking for cube: ', err);
                callback(err, cube);
            });
        });

        ops.push(function (cube, callback) {

            // get datasets
            var datasets = cube.datasets;

            // post options
            var options = {
                datasets : datasets,
                access_token : access_token
            }

            // wu route
            var route = pile.routes.base + pile.routes.get_datasets;

            console.log('calling wu', route);

            // get details on all datasets
            pile.POST(route, options, callback);

        });

        ops.push(function (dataset_details, callback) {


            // console.log('got dataset details!');
            // console.log('dataset_details:', dataset_details);
            // console.log('got dataset details!');


            var test_dataset = _.sample(dataset_details, 1)[0];

            console.log('test_dataset', test_dataset);

            // do sql query on postgis
            var GET_DATA_AREA_SCRIPT_PATH = 'src/get_data_by_area.sh';

            var sql = "'(SELECT * from " + test_dataset.table_name + " as sub) as sub'";
            // var sql = test_dataset.table_name;

            // st_extent script 
            var command = [
                GET_DATA_AREA_SCRIPT_PATH,  // script
                test_dataset.database_name,    // database name
                sql,
                // JSON.stringify(geojson)
                geojson
            ].join(' ');

            console.log('command: ', command);

            // do postgis script
            var exec = require('child_process').exec;
            exec(command, {maxBuffer: 1024 * 50000}, function (err, stdout, stdin) {
                console.log('exec ->', err, stdout, stdin);
                if (err) return callback(err);

                var arr = stdout.split('\n');
                var result = [];
                var points = [];

                console.log('arr', arr);

                // arr.forEach(function (arrr) {
                //     var item = tools.safeParse(arrr);
                //     item && result.push(item);
                // });


                callback(null, dataset_details);

            });

        });
        
        async.waterfall(ops, function (err, dataset_details) {
            if (err) return res.status(400).send(err);

            res.send(dataset_details);
        });

    },

    geojsonFromGeometry : function (geometry) {
        var geojson = {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "properties": {},
              "geometry": geometry
            }
          ]
        }
        return geojson;
    },


    // fetchDataArea : function (options, done) {
    //     var options = req.body;
    //     var geojson = options.geojson;
    //     var access_token = options.access_token;
    //     var cube_id = options.cube_id;

    //     var ops = [];

    //     // // error handling
    //     // if (!geojson) return pile.error.missingInformation(res, 'Please provide an area.')

    //     // ops.push(function (callback) {
    //     //     // retrieve layer and return it to client
    //     //     store.layers.get(layer_id, function (err, layer) {
    //     //         if (err || !layer) return callback(err || 'no layer');
    //     //         callback(null, tools.safeParse(layer));
    //     //     });
    //     // });

    //     ops.push(function (layer, callback) {
    //         var table = layer.options.table_name;
    //         var database = layer.options.database_name;
    //         var polygon = "'" + JSON.stringify(geojson.geometry) + "'";
    //         var sql = '"' + layer.options.sql + '"';

    //         // do sql query on postgis
    //         var GET_DATA_AREA_SCRIPT_PATH = 'src/get_data_by_area.sh';

    //         // st_extent script 
    //         var command = [
    //             GET_DATA_AREA_SCRIPT_PATH,  // script
    //             layer.options.database_name,    // database name
    //             sql,
    //             polygon
    //         ].join(' ');

    //         // do postgis script
    //         var exec = require('child_process').exec;
    //         exec(command, {maxBuffer: 1024 * 50000}, function (err, stdout, stdin) {
    //             console.log('exec ->', err, stdout, stdin);
    //             if (err) return callback(err);

    //             var arr = stdout.split('\n');
    //             var result = [];
    //             var points = [];

    //             arr.forEach(function (arrr) {
    //                 var item = tools.safeParse(arrr);
    //                 item && result.push(item);
    //             });

    //             result.forEach(function (point) {

    //                 // delete geoms
    //                 delete point.geom;
    //                 delete point.the_geom_3857;
    //                 delete point.the_geom_4326;
                    
    //                 // push
    //                 points.push(point);
    //             });

    //             // calculate averages, totals
    //             var average = tools._calculateAverages(points);
    //             var total_points = points.length;

    //             // only return 100 points
    //             if (points.length > 100) {
    //                 points = points.slice(0, 100);
    //             }

    //             // return results
    //             var resultObject = {
    //                 all : points,
    //                 average : average,
    //                 total_points : total_points,
    //                 area : geojsonArea.geometry(geojson.geometry),
    //                 layer_id : layer_id
    //             }

    //             // callback
    //             callback(null, resultObject);
    //         });
    //     });

    //     async.waterfall(ops, function (err, data) {
    //         if (err) console.error({
    //             err_id : 52,
    //             err_msg : 'fetch data area script',
    //             error : err
    //         });
    //         res.json(data);
    //     });
    // },



    // save cube to redis
    save : function (cube, done) {
        store.layers.set(cube.cube_id, JSON.stringify(cube), function (err) {
            done(err, cube);
        });
    },      
    // get cube from redis
    find : function (cube_id, done) {
        store.layers.get(cube_id, function (err, cubeJSON) {
            if (err) return done(err);
            var cube = tools.safeParse(cubeJSON);
            if (!cube) return done('Failed to parse cube:', cubeJSON);
            done(null, cube);
        });
    },
    // get query or body
    getBody : function (req) {
        if (!_.isEmpty(req.body)) return req.body;
        if (!_.isEmpty(req.query)) return req.query;
        return false;
    },
    // get cube request from params
    getCubeRequest : function (req) {
        try {
            var params = req.params['0'].split('/');
            var cube_request = {
                cube_id : params[0],
                dataset : params[1],
                z : params[2],
                x : params[3],
                y : params[4].split('.')[0]
            }
            return cube_request;
        } catch (e) { return false; };
    }

}

var Conv=({
    r_major : 6378137.0,//Equatorial Radius, WGS84
    r_minor : 6356752.314245179,//defined as constant
    f : 298.257223563,//1/f=(a-b)/a , a=r_major, b=r_minor
    deg2rad : function(d) {
        var r=d*(Math.PI/180.0);
        return r;
    },
    rad2deg : function(r) {
        var d=r/(Math.PI/180.0);
        return d;
    },
    ll2m : function(lon,lat) { //lat lon to mercator
    
        //lat, lon in rad
        var x=this.r_major * this.deg2rad(lon);
        if (lat > 89.5) lat = 89.5;
        if (lat < -89.5) lat = -89.5;
        var temp = this.r_minor / this.r_major;
        var es = 1.0 - (temp * temp);
        var eccent = Math.sqrt(es);
        var phi = this.deg2rad(lat);
        var sinphi = Math.sin(phi);
        var con = eccent * sinphi;
        var com = .5 * eccent;
        var con2 = Math.pow((1.0-con)/(1.0+con), com);
        var ts = Math.tan(.5 * (Math.PI*0.5 - phi))/con2;
        var y = 0 - this.r_major * Math.log(ts);
        var ret={'x':x,'y':y};
        return ret;
    },
    m2ll : function(x,y) {//mercator to lat lon
        var lon=this.rad2deg((x/this.r_major));
        var temp = this.r_minor / this.r_major;
        var e = Math.sqrt(1.0 - (temp * temp));
        var lat=this.rad2deg(this.pj_phi2( Math.exp( 0-(y/this.r_major)), e));
        var ret={'lon':lon,'lat':lat};
        return ret;
    },
    pj_phi2 : function(ts, e) {
        var N_ITER=15;
        var HALFPI=Math.PI/2;
        var TOL=0.0000000001;
        var eccnth, Phi, con, dphi;
        var i;
        var eccnth = .5 * e;
        Phi = HALFPI - 2. * Math.atan (ts);
        i = N_ITER;
        do 
        {
            con = e * Math.sin (Phi);
            dphi = HALFPI - 2. * Math.atan (ts * Math.pow((1. - con) / (1. + con), eccnth)) - Phi;
            Phi += dphi;
        } 
        while ( Math.abs(dphi)>TOL && --i);
        return Phi;
    }
});
