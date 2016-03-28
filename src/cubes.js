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
var server = require('./server');
var store  = require('./store');
var proxy = require('./proxy');
var tools = require('./tools');
var queries = require('./queries');

// register mapnik plugins
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();


// global paths (todo: move to config)
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var GRIDPATH     = '/data/grid_tiles/';
var PROXYPATH    = '/data/proxy_tiles/';



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
                var options = cubes.params(req);
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
                var options = cubes.params(req);
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
                var options = cubes.params(req);
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
                var options = cubes.params(req);
                if (!options) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 1});

                // get cube_id
                var cube_id = options.cube_id;
                if (!cube_id) return res.status(400).send({error : 'Please provide a dataset uuid', error_code : 2});

                var ops = [];

                // get cube
                ops.push(function (callback) {
                        cubes.find(cube_id, callback);
                });

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
        // get params, query or body
        params : function (req) {
                if (!_.isEmpty(req.body)) return req.body;
                if (!_.isEmpty(req.query)) return req.query;
                if (!_.isEmpty(req.params)) return req.params;
                return false;
        },


















}
