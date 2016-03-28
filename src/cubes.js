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
var mercator = require('./sphericalmercator');
var geojsonArea = require('geojson-area');

// modules
var config = require(process.env.PILE_CONFIG_PATH || '../../config/pile-config');
// var server = require('./server');
var store  = require('./store');
// var proxy = require('./proxy');
var tools = require('./tools');
// var queries = require('./queries');

// register mapnik plugins
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();


// global paths (todo: move to config)
var VECTORPATH = '/data/vector_tiles/';
var RASTERPATH = '/data/raster_tiles/';
var CUBEPATH   = '/data/cube_tiles/';
var GRIDPATH   = '/data/grid_tiles/';
var PROXYPATH  = '/data/proxy_tiles/';



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
                if (!options) return res.status(400).send({error : 'Please provide a dataset uuid'})
                
                // get uuid
                var cube_id = options.cube_id;
                if (!cube_id) return res.status(400).send({error : 'Please provide a dataset uuid'})

                // get cube
                cubes.find(cube_id, function (err, cube) {
                        if (err) return res.status(400).send({error : 'No such cube_id'}) 
                        res.send(cube);
                });
        },

        add : function (req, res) {

                // get options
                var options = cubes.getBody(req);
                if (!options) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 1});

                // get cube_id
                var cube_id = options.cube_id;
                if (!cube_id) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 2});

                // get datasets
                var datasets = options.datasets;
                if (!datasets.length) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 3});

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
                if (!options) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 1});

                // get cube_id
                var cube_id = options.cube_id;
                if (!cube_id) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 2});

                // get datasets
                var datasets = options.datasets;
                if (!datasets.length) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 3});

                var ops = [];

                // get cube
                ops.push(function (callback) {
                        cubes.find(cube_id, callback);
                });

                ops.push(function (cube, callback) {

                        // remove datasets from array
                        datasets.forEach(function (d) {
                                _.remove(cube.datasets, {uuid : d.uuid});
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
                if (!options) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 1});

                // get cube_id
                var cube_id = options.cube_id;
                if (!cube_id) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 2});

                var ops = [];

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


        tile : function (req, res) {
                var options = cubes.getBody(req);
                var access_token = req.query.access_token;
                var cube_request = cubes.getCubeRequest(req);
                var ops = {};

                if (!cube_request) return res.end(); // todo: error tile

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
                        
                        // create tile
                        // TODO: get from disk if already created
                        cubes.createTile({
                                dataset : results.dataset,
                                cube : results.cube,
                                coords : {                                
                                        z : cube_request.z,
                                        x : cube_request.x,
                                        y : cube_request.y
                                }
                        }, function (err, tile) {

                                // return tile to client
                                res.writeHead(200, {'Content-Type': pile.headers['png']});
                                res.end(tile);
                        });
                });

        },


        createTile : function (options, done) {

                var dataset = options.dataset;
                var cube = options.cube;
                var coords = options.coords;
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
                        var postgis_settings                    = default_postgis_settings;
                        postgis_settings.dbname                 = dataset.database_name;
                        postgis_settings.asynchronous_request   = true;
                        postgis_settings.max_async_connection   = 10;
                        postgis_settings.geometry_field = 'rast';
                        postgis_settings.table  = dataset.table_name;
                        postgis_settings.band   = 1;
                        postgis_settings.type = 'pgraster';


                        try {   
                                map     = new mapnik.Map(256, 256, mercator.proj4);
                                layer   = new mapnik.Layer('layer', mercator.proj4);
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
                        if (1) pile._debugXML(cube.cube_id, map.toXML());

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
                        var keyString = 'cube_tile:' + cube.cube_id + ':' + dataset.file_id + ':' + coords.z + ':' + coords.x + ':' + coords.y + '.png';
                        var path = CUBEPATH + keyString;
                        tile.encode(cube.quality || 'png8', function (err, buffer) {
                                fs.outputFile(path, buffer, function (err) {
                                        callback(null, buffer);
                                });
                        });
                });

                // run ops
                async.waterfall(ops, function (err, tile_buffer) {
                        done(err, tile_buffer);
                });
        },




        // set to redis
        save : function (cube, done) {
                store.layers.set(cube.cube_id, JSON.stringify(cube), function (err) {
                        done(err, cube);
                });
        },      
        // get from redis
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
                } catch (e) {
                        return false;
                };
        }
















}
