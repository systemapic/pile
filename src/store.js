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

// global paths
var VECTORPATH   = '/data/vector_tiles/';
var RASTERPATH   = '/data/raster_tiles/';
var GRIDPATH     = '/data/grid_tiles/';

// config
var config = require('../config/pile-config');

var pile_settings = {
	store : 'disk' // or redis
}

var redisLayers = redis.createClient(config.redis.layers.port, config.redis.layers.host, {detect_buffers : true});
redisLayers.auth(config.redis.layers.auth);
redisLayers.on('error', function (err) { console.error({err_msg : 'redisLayers err: ', error : err}); });
redisLayers.select(config.redis.layers.db, function (err) {
	// console.log('selected db', config.redis.layers.db, err);
})

var redisTemp = redis.createClient(config.redis.temp.port, config.redis.temp.host);
redisTemp.auth(config.redis.temp.auth);
redisTemp.on('error', function (err) { console.error({err_msg : 'redisTemp err: ', error : err}); });
redisTemp.select(config.redis.temp.db, function (err) {
	// console.log('redisTemp db', config.redis.temp.db, err);
});
redisTemp.flushdb(function (err) {
	// console.log('redisTemp flushed db !', err);
});

var redisStats = redis.createClient(config.redis.stats.port, config.redis.stats.host);
redisStats.auth(config.redis.stats.auth);
redisStats.on('error', function (err) { console.error({err_msg : 'redisStats err: ', error : err}); });
redisStats.select(config.redis.stats.db, function (err) {
	// console.log('redisStats db', config.redis.stats.db, err);
})
redisTemp.flushdb(function (err) {
	// console.log('redisTemp flushed db !', err);
});


module.exports = store = { 

	layers : redisLayers,
	temp : redisTemp,
	stats : redisStats,


	// save tiles generically
	_saveVectorTile : function (tile, params, done) {
		if (pile_settings.store == 'redis') return store._saveVectorTileRedis(tile, params, done);
		if (pile_settings.store == 'disk')  return store._saveVectorTileDisk(tile, params, done);
		return done('pile_settings.store not set!');
	},
	_saveRasterTile : function (tile, params, done) {
		if (pile_settings.store == 'redis') return store._saveRasterTileRedis(tile, params, done);
		if (pile_settings.store == 'disk')  return store._saveRasterTileDisk(tile, params, done);
		return done('pile_settings.store not set!');
	},
	_readRasterTile : function (params, done) {
		if (pile_settings.store == 'redis') return store._readRasterTileRedis(params, done);
		if (pile_settings.store == 'disk')  return store._readRasterTileDisk(params, done);
		return done('pile_settings.store not set!');
	},






	// read/write to redis
	_saveVectorTileRedis : function (tile, params, done) {
		// save png to redis
		var keyString = 'vector_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		store.layers.set(key, tile.getData(), done);
	},
	_saveRasterTileRedis : function (tile, params, done) {
		// save png to redis
		var keyString = 'raster_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		store.layers.set(key, tile.encodeSync('png'), done);
	},
	_readRasterTileRedis : function (params, done) {
		var keyString = 'raster_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var key = new Buffer(keyString);
		store.layers.get(key, done);
	},

	



	// read/write to disk
	_saveVectorTileDisk : function (tile, params, done) {
		var keyString = 'vector_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y;
		var path = VECTORPATH + keyString;
		fs.outputFile(path, tile.getData(), done);
	},
	_saveRasterTileDisk : function (tile, params, done) {
		var keyString = 'raster_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y + '.png';
		var path = RASTERPATH + keyString;
		tile.encode('png', function (err, buffer) {
			fs.outputFile(path, buffer, function (err) {
				done(null);
			});
		});
	},
	_readRasterTileDisk : function (params, done) {
		var keyString = 'raster_tile:' + params.layerUuid + ':' + params.z + ':' + params.x + ':' + params.y + '.png';
		var path = RASTERPATH + keyString;
		fs.readFile(path, function (err, buffer) {
			if (err) return done(null);
			done(null, buffer);
		});
	},


}