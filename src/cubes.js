// dependencies
var _ = require('lodash');
var pg = require('pg').native;
var gm = require('gm');
var fs = require('fs-extra');
var kue = require('kue');
var path = require('path');
var zlib = require('zlib');
var uuid = require('uuid');
var async = require('async');
var redis = require('redis');
var carto = require('carto');
var forge = require('node-forge');
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
var moment = require('moment');

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
            timestamp : moment().valueOf(),
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

            // mark changed
            cube.timestamp = moment().valueOf();

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

            // mark changed
            cube.timestamp = moment().valueOf();

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

            // mark changed
            updated_cube.timestamp = moment().valueOf();;

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

    // replace datasets @ same date
    replace : function (req, res) {

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
        // todo: security: only be able to replace own cubes

        var ops = [];

        // get cube
        ops.push(function (callback) {
            cubes.find(cube_id, callback);
        });

        ops.push(function (cube, callback) {
            if (!cube) return callback({message : 'No such cube.'});

            // add datasets to array
            datasets.forEach(function (d) {

                // { 
                //     id: 'file_ckvuatwfkqpyzjxjpygj',
                //     description: 'Filename: snow.raster.2.200.tif',
                //     timestamp: 'Fri May 20 2016 11:33:20 GMT+0000 (UTC)',
                //     granularity: 'day' 
                // }

                // get moment() datestamp of dataset to add
                var datestamp = moment(d.timestamp);

                // time resolution
                var granularity = d.granularity || 'day';

                // check if dataset exists at same time, by resolution
                var i = _.findIndex(cube.datasets, function (cd) {
                    return moment(cd.timestamp).isSame(datestamp, granularity);
                });

                // already exists a dataset on this day, replace!
                if (i > -1) {

                    // replace dataset
                    cube.datasets[i] = d;

                    // mark changed
                    cube.timestamp = moment().valueOf();

                    // log
                    console.log('Replacing dataset', cube.timestamp);

                }

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

        // console.log('mask', options);

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
                var topology = topojson.topology({collection: collection}, {
                    verbose : true,
                    id : function (d) {
                        return d.properties.ID; // hardcoded for snow! todo: add to options
                    },
                    'property-transform': function (feature) {
                        return feature.properties;
                    }
                });

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
                    var topology = topojson.topology({collection: collection}, {
                        verbose : true,
                        id : function (d) {
                            return d.properties.ID; // hardcoded for snow! todo: add to options
                        },
                        'property-transform': function (feature) {
                            return feature.properties;
                        }
                    });

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
                timestamp : moment().valueOf()
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

            // mark changed
            cube.timestamp = moment().valueOf();
 
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

    // todo: cluster it up!
    _serveTile : function (options, res) {

        // get options
        var cube = options.cube;
        var dataset = options.dataset;
        var cube_request = options.cube_request;

        // check if tile is outside bounds if dataset
        var outside_extent = cubes._isOutsideExtent(options);

        if (outside_extent) {
            // console.log('Serving empty tile (outside extent)')
            return pile.serveEmptyTile(res);
        }

        // create unique hash for style
        var style_hash = forge.md.md5.create().update(cube.style + cube.timestamp).digest().toHex();

        // define path
        var keyString = 'cube_tile:' + cube.cube_id + ':' + dataset.file_id + ':' + style_hash + ':' + cube_request.z + ':' + cube_request.x + ':' + cube_request.y + '.png';
        var tilePath = CUBEPATH + keyString;

        // check for cached tile
        fs.readFile(tilePath, function (err, tile_buffer) {
            if (!err && tile_buffer) {

                // return cached tile
                // console.log('Serving cached tile', cube_request.z + ':' + cube_request.x + ':' + cube_request.y);
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
        }).priority('low').attempts(5).save();

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
        var query_type = options.query_type;

        console.log('query');
        
        // snow cover fraction
        if (query_type == 'scf') return cubes.queries.scf(req, res);

        // return unsupported
        res.status(400).send({error : 'Query type not supported:' + query_type});

    },

    queries : {

        // snow cover fraction query (red line in client)
        // either get query from cache, or do new query
        scf : function (req, res) {
            var options = req.body;
            var multi_mask = options.mask ? options.mask.multi_mask : false;

            if (multi_mask) {
                
                // multi mask query
                cubes.queries.scf_multi_mask(req, res);
            
            } else {

                // single mask query
                cubes.queries.scf_single_mask(req, res);

            }

        },

       
        scf_multi_mask : function (req, res) {
            var options     = req.body;
            var query_type  = options.query_type;
            var cube_id     = options.cube_id;
            var mask_id     = options.mask ? options.mask.mask_id : false;
            var year        = options.year;
            var force_query = options.options ? options.options.force_query : false;
            var ops         = [];

            console.log('scf_multi_mask', options);

            // check for already stored query
            var query_key = 'query:type' + query_type + ':' + cube_id + ':year-' + year + ':mask_id-' + mask_id;
            store.layers.get(query_key, function (err, stored_query) {
                
                // return stored query if any
                if (!err && _.size(stored_query) && !force_query) return res.end(stored_query);

                // create and run new query
                cubes.queries.create_scf_multi_mask_query(options, function (err, query) {

                    // return to client
                    res.send(query);                      

                });
            });
        },


        create_scf_multi_mask_query : function (options, done) {
            var query_type = options.query_type;
            var access_token = options.access_token;
            var cube_id = options.cube_id;
            var geometries = options.mask ? options.mask.geometries : false;
            var mask_id = options.mask ? options.mask.mask_id : false;
            var query_type = options.query_type;
            var year = options.year;
            var day = options.day;
            var ops = [];

            // get cube
            ops.push(function (callback) {
                console.log('find cube');
                cubes.find(cube_id, callback);
            });

            // get relevant datasets to query, from [wu]
            ops.push(function (cube, callback) {
                console.log('get relevant datasets');

                // get cube datasets
                var datasets = cube.datasets;

                // filter cube's datasets for this year only
                var datasets_in_range = _.filter(datasets, function (d) {
                    var current = moment(d.timestamp);
                    var before = moment().year(year).dayOfYear(1);
                    var after = moment().year(year).dayOfYear(365);
                    return (current.isSameOrAfter(before) && current.isSameOrBefore(after));
                });

                // get details on all datasets
                pile.POST(pile.routes.base + pile.routes.get_datasets, {
                    datasets : datasets_in_range,
                    access_token : access_token,
                }, function (err, dataset_details){
                    callback(err, dataset_details, cube);
                });

            });

            // fix mask
            ops.push(function (dataset_details, cube, callback) {
                console.log('fix mask', _.size(dataset_details));

                var options = {
                    datasets : dataset_details,
                    cube : cube
                }

                var geometry_results = [];

                // query each geometry
                async.eachSeries(geometries, function (geom, each_callback) {

                    // create geojson from geometry
                    options.mask = cubes.geojsonFromGeometry(geom);

                    // query multiple datasets
                    cubes.queries.query_snow_cover_fraction_multi_mask(options, function (err, each_result) {

                        // remember
                        geometry_results.push(each_result);

                        // return
                        each_callback(err);

                    });
                
                }, function (err) {

                    var dates = {};

                    // iterate results per mask
                    geometry_results.forEach(function (r) {

                        // iterate
                        r.forEach(function (rr) {

                            // get date
                            var date = rr.date;

                            // sum results
                            rr.rows.forEach(function (row) {

                                // get values/count
                                var value = row.row_to_json.pvc.value;
                                var count = row.row_to_json.pvc.count;

                                // create key
                                dates[date] = dates[date] || {}; // will happen 9 times

                                // add 
                                dates[date][value] = _.isUndefined(dates[date][value]) ? count : dates[date][value] + count;

                            });

                        });
                    });

                    // calculate snow cover fraction
                    var snow_cover_fractions = cubes.queries._calculateSnowCoverFraction(dates);

                    // return scf
                    callback(err, snow_cover_fractions);

                });
               
            });

            
            async.waterfall(ops, function (err, scfs) {

                // catch errors
                if (err) return done(err);

                // save query to redis cache
                var query_key = 'query:type' + query_type + ':' + cube_id + ':year-' + year + ':mask_id-' + mask_id;
                store.layers.set(query_key, JSON.stringify(scfs), function (err) {

                    // done
                    done(null, scfs);

                });
            });

        },


        query_snow_cover_fraction_multi_mask : function (options, done) {

            var datasets = options.datasets;
            var cube = options.cube;
            var mask = options.mask;
            var queryOptions;
            var n = 0;
            var query_results = [];

            // set query id
            var query_id = 'query-' + tools.getRandomChars(10);

            // query each dataset
            async.eachSeries(datasets, function (dataset, callback) {

                // get dataset date
                var timestamp_dataset = _.find(cube.datasets, function (d) {
                    return d.id == dataset.table_name;
                })
                if(!timestamp_dataset) return callback(null);
                var dataset_date = timestamp_dataset.timestamp;

                // set query options
                queryOptions = {
                    dataset : dataset,
                    query_num : n++,
                    query_id : query_id,
                    dataset_date : dataset_date, // get date of dataset in cube, not timestamp of dataset
                    mask : mask,
                }

                console.log('dataset_date', dataset_date);
                console.log('dataset:', dataset);

                // create query
                cubes.queries.postgis_snowcover(queryOptions, function (err, pg_result) {
                    
                    // get rows
                    var rows = pg_result.rows;

                    // get date from cube dataset (not from dataset internal timestamp)
                    var cubeDatasetTimestamp = queryOptions.dataset_date;

                    // results
                    var scf_results = {
                        date : moment(cubeDatasetTimestamp).format(),
                        rows : rows
                    };

                    // write results to redis
                    query_results.push(scf_results);

                    callback();

                });

            }, function (err) {

                done(err, query_results);

            });

        },


        postgis_snowcover : function (options, done) {

            // options
            var dataset = options.dataset;
            var geojson = options.mask;
            var cube = options.cube;
            var query_id = options.query_id;
            var query_num = options.query_num;

            // get postgis compatible geojson
            var pg_geojson = cubes._retriveGeoJSON(geojson);

            // set postgis options
            var pg_username = process.env.SYSTEMAPIC_PGSQL_USERNAME;
            var pg_password = process.env.SYSTEMAPIC_PGSQL_PASSWORD;
            var pg_database = dataset.database_name;

           

            // set connection string
            var conString = 'postgres://' + pg_username + ':' + pg_password + '@postgis/' + pg_database;

            // initialize a connection pool
            pg.connect(conString, function(err, client, pg_done) {
                if (err) return console.error('error fetching client from pool', err);

                // create query with geojson mask
                if (pg_geojson) {
                 
                    // with mask
                    var query = "select row_to_json(t) from (SELECT rid, pvc FROM " + dataset.table_name + ", ST_ValueCount(rast,1) AS pvc WHERE st_intersects(st_transform(st_setsrid(ST_geomfromgeojson('" + pg_geojson + "'), 4326), 3857), rast)) as t;"
               
                } else {
                 
                    // without mask
                    var query = "select row_to_json(t) from (SELECT rid, pvc FROM " + dataset.table_name + ", ST_ValueCount(rast,1) AS pvc ) as t;"
               
                }

                // query postgis
                client.query(query, function(err, pg_result) {
                   
                    // call `pg_done()` to release the client back to the pool
                    pg_done();

                    done(err, pg_result);
                });
            });
        },



        _calculateSnowCoverFraction : function (all_dates) {

            // console.log('_calculateSnowCoverFraction', all_dates);

            // '2016-02-23T23:00:00+00:00': { 
            //     '20': 90425,
            //     '100': 13814,
            //     '101': 380,
            //     '102': 545,
            //     '103': 648,
            //     '104': 611,

            var dates = [];

            _.forEach(all_dates, function (values, date) {

                var avg_sum = 0;
                var count_sum = 0;

                _.forEach(values, function (count, pixel_value) {

                    var moved_value = pixel_value - 100;
                    
                    // only include pixels with values between 100-200
                    // if (pixel_value >= 100 && pixel_value <= 200) {
                    if (moved_value >= 0 && moved_value <= 100) {
                        // avg_sum += count * pixel_value;
                        avg_sum += count * moved_value;
                        count_sum += count;
                    }
                });

                // var scf = (avg_sum / count_sum) - 100;
                var scf = (avg_sum / count_sum);

                dates.push({
                    date : date,
                    SCF : scf
                });

            });

            return dates;

        },

       
        scf_single_mask : function (req, res) {
            var options     = req.body;
            var query_type  = options.query_type;
            var cube_id     = options.cube_id;
            var mask_id     = options.mask ? options.mask.mask_id : false;
            var year        = options.year;
            var force_query = options.options ? options.options.force_query : false;
            var ops         = [];

            console.log('scf_single_mask', options);

            // check for already stored query
            var query_key = 'query:type' + query_type + ':' + cube_id + ':year-' + year + ':mask_id-' + mask_id;
            console.log('query_key:', query_key);
            store.layers.get(query_key, function (err, stored_query) {

                console.log('query_key', query_key, err, _.size(stored_query));

                // return stored query if any
                if (!err && stored_query && !force_query) return res.end(stored_query);

                // create and run new query
                cubes.queries.create_scf_single_mask_query(options, function (err, query) {

                    // return to client
                    res.send(query);                      

                });
            });
        },


        create_scf_single_mask_query : function (options, done) {
            var query_type = options.query_type;
            var access_token = options.access_token;
            var cube_id = options.cube_id;
            var geometry = options.mask ? options.mask.geometry : false;
            var mask_id = options.mask ? options.mask.mask_id : false;
            var multi_mask = options.mask ? options.mask.multi : false;
            var query_type = options.query_type;
            var year = options.year;
            var day = options.day;
            var ops = [];

            console.log('create single');

            // get cube
            ops.push(function (callback) {
                cubes.find(cube_id, callback);
            });

            // get relevant datasets to query, from [wu]
            ops.push(function (cube, callback) {

                // get cube datasets
                var datasets = cube.datasets;

                console.log('cube datasets', _.size(datasets));

                // filter cube's datasets for this year only
                var withinRange = _.filter(datasets, function (d) {
                    var current = moment(d.timestamp);
                    var before = moment().year(year).dayOfYear(1);
                    var after = moment().year(year).dayOfYear(365);
                    return (current.isSameOrAfter(before) && current.isSameOrBefore(after));
                });

                // get details on all datasets
                pile.POST(pile.routes.base + pile.routes.get_datasets, {
                    datasets : withinRange,
                    access_token : access_token,
                }, function (err, dataset_details){
                    callback(err, dataset_details, cube);
                });

            });

            // fix mask
            ops.push(function (dataset_details, cube, callback) {

                var options = {
                    datasets : dataset_details,
                    // mask : mask,
                    cube : cube
                }

                if (geometry == 'all') {

                    // get mask from topojson
                    var topo_mask = cube.mask;

                    // todo: add to options??
                    console.log('geom all');
                    
                    callback(null, options);

                } else {
                    
                    // create geojson from geometry
                    options.mask = cubes.geojsonFromGeometry(geometry);

                    console.log('mask ', options.mask);

                    // continue
                    callback(null, options);
                }
               
            });

            ops.push(function (options, callback) {

                // query multiple datasets
                cubes.queries.query_snow_cover_fraction_single_mask(options, callback);
              
            });
            
            
            async.waterfall(ops, function (err, scfs) {
                console.log('all done 2', err, _.size(scfs));

                // catch errors
                if (err) return done(err);

                // save query to redis cache
                var query_key = 'query:type' + query_type + ':' + cube_id + ':year-' + year + ':mask_id-' + mask_id;
                store.layers.set(query_key, JSON.stringify(scfs), function (err) {
                    console.log('saved: ', query_key, err);

                    // done
                    done(null, scfs);

                });
            });

        },


        

        query_snow_cover_fraction_single_mask : function (options, done) {
            var datasets = options.datasets;
            var cube = options.cube;
            var mask = options.mask;
            var queryOptions;
            var n = 0;
            var query_results = [];

            // set query id
            var query_id = 'query-' + tools.getRandomChars(10);

            // query each dataset
            async.eachSeries(datasets, function (dataset, callback) {

                console.log('querying each');

                var timestamp_dataset = _.find(cube.datasets, function (d) {
                    return d.id == dataset.table_name;
                })
                if(!timestamp_dataset) return callback(null);
                var dataset_date = timestamp_dataset.timestamp;

                // set query options
                queryOptions = {
                    dataset : dataset,
                    query_num : n++,
                    query_id : query_id,
                    dataset_date : dataset_date, // get date of dataset in cube, not timestamp of dataset
                    mask : mask,
                }

                // create query
                cubes.queries.postgis_snowcover(queryOptions, function (err, pg_result) {
                    if (err) return callback(err);
                    
                    // get rows
                    var rows = pg_result.rows;

                    // calculate snow cover fraction
                    var averagePixelValue = cubes._getSnowCoverFraction(rows);

                    // get date from cube dataset (not from dataset internal timestamp)
                    var cubeDatasetTimestamp = queryOptions.dataset_date;

                    // results
                    var scf_results = {
                        date : moment(cubeDatasetTimestamp).format(),
                        SCF : averagePixelValue,
                        rows : rows
                    };

                    // // write results to redis
                    // var key = query_id + '-' + queryOptions.query_num;
                    // store.temp.set(key, JSON.stringify(scf_results), callback);

                    query_results.push(scf_results);

                    // callback
                    callback(null);

                });

            }, function (err) {

                console.log('all done -->', err, _.size(query_results));

                done(err, query_results);

                // // get query result from redis
                // async.times(n, function (i, next) {
                //     var key = queryOptions.query_id + '-' + i;
                //     store.temp.get(key, function (err, part) {

                //         // parse parts
                //         next(err, tools.safeParse(part));
                //     });
                // }, done);
            });

        },



    },













    // get PostGIS compatible GeoJSON
    _retriveGeoJSON : function (geojson) {
        if (!geojson) return false;
        try {
            return JSON.stringify(geojson.features[0].geometry);
        } catch (e) {
            return false;
        }
    },

    _getSnowCoverFraction : function (rows) {

        // clean up 
        var pixelValues = {};

        // get values, count
        rows.forEach(function (r) {

            var data = r.row_to_json.pvc; // {"value":156,"count":3}
            var value = data.value;
            var count = data.count;

            // only include values between 101-200
            if (value >= 100 && value <= 200) {
                if (pixelValues[value]) {
                    pixelValues[value] += count;
                } else {
                    pixelValues[value] = count;
                }
            }
        });

        // sum averages
        var avg_sum = 0;
        var tot_count = 0;
        _.forEach(pixelValues, function (p, v) {
            avg_sum += p * v;
            tot_count += p;
        });

        // calculate average
        var average = avg_sum / tot_count;
        var scf = average - 100; // to get %

        return scf;

    },

    geojsonFromGeometry : function (geometry) {
        if (!geometry) return false;

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

}



// http://wiki.openstreetmap.org/wiki/Mercator#JavaScript
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
