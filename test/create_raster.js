// dependencies
// var _ = require('lodash');
// var fs = require('fs-extra');
// var kue = require('kue');
// var path = require('path');
// var zlib = require('zlib');
// var uuid = require('uuid');
// var async = require('async');
// var redis = require('redis');
// var carto = require('carto');
var mapnik = require('mapnik');
// var colors = require('colors');
// var cluster = require('cluster');
// var numCPUs = require('os').cpus().length;
// var mapnikOmnivore = require('mapnik-omnivore');
var SphericalMercator = require('sphericalmercator');
var mercator = new SphericalMercator();
// var GrainStore = require('grainstore');


// trying to create a simple raster tile from postgis


var database_name = 'zzjihbcpqm';

// cetin3, EPSG:32638
var table_name = 'shape_qbbdijgmex';

// cadastral, srid: 4326
var table_name = 'shape_dszhjnseex';

// cadastral
var query = {
	x : 13,
	y : 7533,
	z : 4915,
	style : 'polygon'
}

var postgis_settings = {
	'dbname' : database_name,
	'extent' : '-20005048.4188,-9039211.13765,19907487.2779,17096598.5401',
	'geometry_field' : 'geom',
	'srid' : 4326,
	'user' : 'docker',
	'host' : 'postgis',
	'dbpassword' : 'docker',
	'dbuser' : 'docker',
	'max_size' : 1,
	'type' : 'postgis',
	'table' : table_name
}


var bbox = mercator.bbox(parseInt(query.x),
			 parseInt(query.y),
			 parseInt(query.z), false);

var map = new mapnik.Map(256, 256, '4326');
// map.bufferSize(64);
var layer = new mapnik.Layer('tile', '4326');

// settings.postgis.table = table_name

var postgis = new mapnik.Datasource(postgis_settings);
layer.datasource = postgis;
styles = [query.style];
map.load('./polygon.xml');

// labels
// styles.push('text');
// map.load(path.join(settings.styles, 'text.xml'));

layer.styles = styles;
map.add_layer(layer);
// show map in terminal with toString()
console.log(map.toString());


map.render(bbox, 'png', function(err, buffer) {
	if (err) console.log('ERR', err);
	console.log(map.scaleDenominator());

	var filename = './test/' + table_name + '.png';
	fs.writeFile(filename, buffer, function(err) {
		if (err) console.log(err);
		console.log('saved map image to', filename);
	});

});


















