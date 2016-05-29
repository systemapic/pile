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
var mongoose = require('mongoose');
var request = require('request');
var prompt   = require('prompt');

// config
// var config = require('../config/wu-config');
var config = require(process.env.PILE_CONFIG_PATH || '../../config/pile-config');


// redis store for temp tokens and upload increments
var redisLayers = require('redis').createClient(config.redis.layers.port, config.redis.layers.host);
redisLayers.on('error', function (err) {console.log('Redis error: ', err);});
redisLayers.auth(config.redis.layers.auth);

// redis store for temp tokens and upload increments
var redisStats = require('redis').createClient(config.redis.stats.port, config.redis.stats.host);
redisStats.on('error', function (err) {console.log('Redis error: ', err);});
redisStats.auth(config.redis.stats.auth);

// redis store for temp tokens and upload increments
var redisTemp = require('redis').createClient(config.redis.temp.port, config.redis.temp.host);
redisTemp.on('error', function (err) {console.log('Redis error: ', err);});
redisTemp.auth(config.redis.temp.auth);


var whichRedis = process.argv[2];
var searchKey = process.argv[3];


if (!whichRedis) {
    console.log('Please provide args: node search_redis_keys.js [layers|stats|temp] [keyToDelete]')
    process.exit(1);
}

console.log('Going to delete in ', whichRedis, 'the key', searchKey);

var r;

// which redis instance
if (whichRedis == 'layers') {
    r = redisLayers;
}
if (whichRedis == 'stats') {
    r = redisStats;
}
if (whichRedis == 'temp') {
    r = redisTemp;
}

// select database 2
r.select(2, function () {

    prompt.get({
        properties : {
            confirm : {
                description : 'Does this look right? Write [yes] to go ahead and delete key'.yellow
            }
        }
    }, function (err, answer) {
        if (err || answer.confirm != 'yes') {
            console.log('Aborting!');
            return process.exit(0);
        }

        r.del(searchKey, function (err) {
            if (err) {
                console.log('failed to delete!', err);
            } else {
                console.log('deleted!');
            }
            process.exit(err);
        })
    });


});
