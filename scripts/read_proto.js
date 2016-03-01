#!/usr/local/bin/node
var VectorTile = require('vector-tile').VectorTile;
var Protobuf = require('pbf');
var fs = require('fs');
var _ = require('lodash');
var Pbf = require('pbf');
// vector_tile:layer_id-f37f85aa-acc1-4016-9cbb-22810d20afc1:17:70741:33046.pbf

// // 11 MB tile ->
// var layer_id = 'layer_id-93aa971e-8fb2-47f4-913c-00157555a2db';
// var tile_coords = [10, 570, 234];
// var file = 'vector_tile:' + layer_id + ':' + tile_coords.join(':') + '.pbf';

// var file = 'vector_tile:layer_id-f37f85aa-acc1-4016-9cbb-22810d20afc1:17:70741:33046.pbf';
// var file = 'vector_tile:layer_id-f37f85aa-acc1-4016-9cbb-22810d20afc1:15:17684:8261.pbf';
var file = 'vector_tile:layer_id-93aa971e-8fb2-47f4-913c-00157555a2db:13:4560:1876.pbf'; // deformasjon
var proto_file = '/data/vector_tiles/' + file;

var proto_file = 'test.pbf';
var proto_file_gz = 'test.pbf.gz';
var data = fs.readFileSync(proto_file);
var tile = new VectorTile(new Protobuf(data));


console.log('');
console.log('===========================');
console.log('   Data:')
console.log('===========================');
var f = file.split(':');
var layer_id = f[1];
var tile_coords = [f[2], f[3], f[4]];
console.log('Layer ID:', layer_id);
console.log('Tile coords:', tile_coords);
console.log('File path: ', proto_file);
console.log('Data length:', data.length);


console.log('');
console.log('===========================');
console.log('   Tile:')
console.log('===========================');
console.log('Tile: ', tile);
console.log('');
console.log('Number of layers: ', _.size(tile.layers));


console.log('');
console.log('===========================');
console.log('   Layer:')
console.log('===========================');
var layer = tile.layers.layer;
console.log('Number of features: ', layer.length);


console.log('');
console.log('===========================');
console.log('   Single feature:')
console.log('===========================');
var feature_1 = layer.feature(1);
console.log('feature(1) _keys: ', feature_1._keys);
console.log('feature(1) _values.length: ', feature_1._values.length);
console.log('feature(1) type: ', feature_1.type);
console.log('feature(1) extent: ', feature_1.extent);
console.log('feature(1) properties: ', feature_1.properties);
// console.log('feature_1 toGeoJSON', layer.feature(1).toGeoJSON());
// console.log('feature_1 loadGeometry', layer.feature(1).loadGeometry() );




console.log('');
console.log('===========================');
console.log('  Protobuffer:')
console.log('===========================');
var data = new Pbf(fs.readFileSync(proto_file_gz)).readFields(readData, {});
console.log('pbf data size:', _.size(data));
console.log('pbf data keys:', _.keys(data));
console.log('data.layer size', _.size(data.layer));
console.log('data.layer keys', _.keys(data.layer));
console.log('data.layer.name size', _.size(data.layer.name));
// console.log('data.layer.name keys', _.keys(data.layer.name));
// console.log('data.layer.name -> ', data.layer.name); // -> buffer
console.log('data.layer.name -> ', data.layer.name[1919]); //
// console.log('data.layer.name[0] size', _.size(data.layer.name[72370]));
// console.log('data.layer.name[0]', data.layer.name[72370]);


function readData(tag, data, pbf) {
	console.log('tag:', tag);
	if (tag === 1)		 data.name = pbf.readString();
	else if (tag === 2) 	data.version = pbf.readVarint();
	else if (tag === 3) 	data.layer = pbf.readMessage(readLayer, {});

	// // console.log('data:', data);
	// console.log('data.name', data.name);
	// console.log('data.version', data.version);
	// console.log('data.layer', _.size(data.layer));
}
function readLayer(tag, layer, pbf) {
	if (tag === 1) 	    	layer.name = pbf.readString();
	else if (tag === 3) 	layer.size = pbf.readVarint();
}