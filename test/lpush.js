var redis = require('redis');
var config = require('../config/pile-config');
// create another connection for kueredis
var kueStore = redis.createClient(config.kueredis.port, config.kueredis.host);
kueStore.auth(config.kueredis.auth);
kueStore.on('error', function (err) { console.error(err); });


var key = 'okkey';
var value = 'sdd';

kueStore.rpush(key, value, function (err) {
	console.log('err? ', err);

	kueStore.lrange(key, 0, -1, function (err, result) {
		console.log('result: ', err, result);
	})
});

