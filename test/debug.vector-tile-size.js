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
var VectorTile = require('vector-tile').VectorTile; // https://www.npmjs.com/package/vector-tile
var Protobuf = require('pbf');
var gm = require('gm');
var bars = require('bars');
var sanitize = require("sanitize-filename");
var mercator = require('../src/sphericalmercator');
var geojsonArea = require('geojson-area');
var server = require('../src/server');
var config = require('../../config/pile-config');
var store  = require('../src/store');
var proxy = require('../src/proxy');
var tools = require('../src/tools');
var queries = require('../src/queries');
mapnik.register_default_fonts();
mapnik.register_default_input_plugins();
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var GRIDPATH     = '/data/grid_tiles/';
var PROXYPATH    = '/data/proxy_tiles/';
var pgsql_options = {
    dbhost: 'postgis',
    dbuser: process.env.SYSTEMAPIC_PGSQL_USERNAME || 'docker',
    dbpass: process.env.SYSTEMAPIC_PGSQL_PASSWORD || 'docker'
};

var start_time = new Date().getTime();

// tile
var params = {
    layer_id : 'layer_id-253678e7-9c75-4918-98d2-2def5b6bc95d',
    // layer_id : 'layer_id-01a284d7-8560-4393-aed0-b23aa1aeec49', // raster
    z : 7,
    x : 68,
    y : 36,
    type : 'pbf',
}

// output path
var vector_tile_path = 'test/tmp/vector-tile-size.debug.pbf'

// process.argv[0] is the  "node" executable
// process.argv[1] is this script path
if ( process.argv[2] )
{
  proto_path = process.argv[2];
  debug_vector_tile(proto_path);
  process.exit(0);
}
else
{
  // render, then debug
  render_vector_tile(params, function (err, proto_path) {

      if ( err ) throw new Error(err);

      // print debug
      debug_vector_tile(proto_path);

      // quit
      process.exit(0);
  });
}









// helper functions
// -------------------------------------------
function debug_vector_tile(proto_path, done) {

    // read file
    var data = fs.readFileSync(proto_path);
    var tile = new VectorTile(new Protobuf(data));
 
    var end_time = new Date().getTime();
    var total_time = end_time - start_time;

    console.log('\n\nDebug data:')
    console.log('-------------------------------');
    console.log('File path: ', proto_path);
    console.log('Data length:', data.length);

    // console.log('tile:', tile);

    var layer = tile.layers.layer;
    // console.log('layer:', layer);
    var feature_1 = layer.feature(1);


    console.log('Number of layers: ', _.size(tile.layers));
    console.log('Number of features: ', layer.length);
    console.log('layer.feature(1)._keys: ', feature_1._keys);
    console.log('layer.feature(1)._values.length: ', feature_1._values.length);
    console.log('layer.feature(1).type: ', feature_1.type);
    console.log('layer.feature(1).extent: ', feature_1.extent);
    console.log('layer.feature(1).properties: ', feature_1.properties);
    console.log('\nRendering took', total_time, 'ms');

    done && done();
}

function render_vector_tile(params, done) {

    // prepare tile: 
    var ops = [];
    var map;
    var layer;
    var postgis;
    var bbox;

    // check params
    if (!params.layer_id)      return done('Invalid url: Missing layer_id.');
    if (params.z == undefined) return done('Invalid url: Missing tile coordinates. z', params.z);
    if (params.x == undefined) return done('Invalid url: Missing tile coordinates. x', params.x);
    if (params.y == undefined) return done('Invalid url: Missing tile coordinates. y', params.y);
    if (!params.type)          return done('Invalid url: Missing type extension.');

    // get stored layer_id
    ops.push(function (callback) {
        store.layers.get(params.layer_id, callback);
    });

    // define settings, xml
    ops.push(function (storedLayer, callback) {
        if (!storedLayer) return callback('No such layer_id.');

        var storedLayer = tools.safeParse(storedLayer);

        console.log('\n\nStored layer:')
        console.log('-------------------------------');
        console.log(storedLayer);

        // default settings
        var default_postgis_settings = {
            user            : pgsql_options.dbuser,
            password        : pgsql_options.dbpass,
            host            : pgsql_options.dbhost,
            type            : 'postgis',
            geometry_field  : 'the_geom_3857',
            srid            : '3857'
        }

        // set bounding box
        bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

        // insert layer settings 
        // https://github.com/mapnik/mapnik/blob/master/plugins/input/postgis/postgis_datasource.cpp#L62
        var postgis_settings                    = default_postgis_settings;
        postgis_settings.dbname                 = storedLayer.options.database_name;
        postgis_settings.table                  = storedLayer.options.sql;
        // postgis_settings.table                  = '(SELECT * FROM file_sdyidyyxqhllocmfevlt where val > 100) as sub'
        // postgis_settings.table                  = '(SELECT * FROM file_sdyidyyxqhllocmfevlt where val < 150) as sub'
        // postgis_settings.extent                 = storedLayer.options.extent || bbox;
        postgis_settings.extent                 = bbox;
        postgis_settings.geometry_field         = storedLayer.options.geom_column;
        postgis_settings.srid                   = storedLayer.options.srid;
        postgis_settings.max_async_connection   = 6;
        // postgis_settings.row_limit              = 100; // works
        postgis_settings.simplify_dp_ratio      = 1.0/1.0; // no effect on size
        // postgis_settings.simplify_geometries    = true; // no effect :(
        // postgis_settings.simplify_clip_resolution = 3.0;


        console.log('\n\nPostGIS settings:')
        console.log('-------------------------------');
        console.log(postgis_settings);
        console.log('mercator.proj4:', mercator.proj4);

        // everything in spherical mercator (3857)! ... mercator.proj4 == 3857 == +proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over
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

        // done
        callback(null, map);
    });

    ops.push(function (map, callback) {

         // vector
        var im = new mapnik.VectorTile(params.z, params.x, params.y);
        
        // check
        if (!im) return callback('Unsupported type.')

        // render
        map.render(im, {}, function (err, tile) {
            if (err) return callback(err);
            console.log('\n\nmap.toXML()')
            console.log('-------------------------------');
            console.log(map.toXML());

            callback(err, tile);
        });
    });



    // run ops
    async.waterfall(ops, function (err, tile) {
        if (err) return done(err);
       
        // write to disk
        fs.writeFile(vector_tile_path, tile.getData(), function (err) {
            done(err, vector_tile_path);
        });
    });
};





