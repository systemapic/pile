var assert = require('assert');
var mongoose = require('mongoose');
var async = require('async');
var fs = require('fs-extra');
var crypto = require('crypto');
var request = require('request');
var supertest = require('supertest');
var api = supertest('https://' + process.env.SYSTEMAPIC_DOMAIN);
var endpoints = require('./endpoints.js');
var helpers = require('./helpers');
var token = helpers.token;
var path = require('path');
var httpStatus = require('http-status');
var chai = require('chai');
var expect = chai.expect;
var config = require('/systemapic/config/wu-config.js').clientConfig;
var tmp = {};
var http = require('http-request');
var assert = require('assert');
// var debugMode = process.env.SYSTEMAPIC_DEBUG;
var debugMode = true;
if (debugMode) {
    console.log('Debug mode!');
}

describe('Raster', function () {
    this.slow(400);

    context('GeoTIFF -> snow.raster.200.tif', function () {
        this.timeout(11000);

        it('should upload', function (done) {
            token(function (err, access_token) {
            api.post(endpoints.import.post)
                .type('form')
                .field('access_token', access_token)
                .field('data', fs.createReadStream(path.resolve(__dirname, './open-data/snow.raster.200.tif')))
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var result = res.body;
                    if (debugMode) {
                        console.log('\n\n\n');
                        console.log('Upload status: POST', endpoints.import.post, '[wu]:')
                        console.log('------------------------------------------')
                        console.log(result);
                    }

                    expect(result.file_id).to.exist;
                    expect(result.user_id).to.exist;
                    expect(result.upload_success).to.exist;
                    expect(result.filename).to.be.equal('snow.raster.200.tif');
                    expect(result.status).to.be.equal('Processing');

                    tmp.upload_status = result;
                    
                    done();
                });
            });
        });

        it('should have a status', function (done) {
            token(function (err, access_token) {
                api.get(endpoints.import.status)
                .query({file_id : tmp.upload_status.file_id, access_token : access_token})
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var result = helpers.parse(res.text);
                    if (debugMode) {
                        console.log('\n\n\n');
                        console.log('Upload status: GET', endpoints.import.status, '[wu]:');
                        console.log('------------------------------------------')
                        console.log(result);
                    }

                    expect(result.file_id).to.exist;
                    expect(result.user_id).to.exist;
                    expect(result.upload_success).to.exist;
                    expect(result.upload_success).to.be.true;
                    expect(result.filename).to.be.equal('snow.raster.200.tif');
                    expect(result.status).to.be.equal('Processing');
                    done();
                });
            });
        });

        it('should process', function (done) {
            this.timeout(10000);
            this.slow(5000);

            // check for processing status
            token(function (err, access_token) {
                var processingInterval = setInterval(function () {
                    process.stdout.write('.');
                    api.get(endpoints.import.status)
                    .query({ file_id : tmp.upload_status.file_id, access_token : access_token})
                    .end(function (err, res) {
                        if (err) return done(err);

                        var status = helpers.parse(res.text);

                        if (status.processing_success) {
                            if (debugMode) {
                                console.log('\n\n\n');
                                console.log('Upload status: when done processing', '[wu]:');
                                console.log('------------------------------------------')
                                console.log(status);
                            }
                            clearInterval(processingInterval);
                            expect(status.upload_success).to.exist;
                            expect(status.status).to.be.equal('Done');
                            expect(status.filename).to.be.equal('snow.raster.200.tif');
                            expect(status.error_code).to.be.null;
                            expect(status.error_text).to.be.null;
                            done();
                        }
                    });
                }, 500);
            });
        });

    
        it('should create a raster layer', function (done) {
            this.timeout(40000);
            token(function (err, access_token) {

                var layer = {
                    geom_column: 'the_geom_3857',
                    geom_type: 'geometry',
                    raster_band: '',
                    data_type : 'raster',
                    srid: '',
                    affected_tables: '',
                    interactivity: '',
                    attributes: '',
                    access_token: access_token,
                    cartocss_version: '2.0.1',
                    "cartocss": "#layer { raster-opacity:1.0 }",
                    sql: '(SELECT * FROM ' + tmp.upload_status.file_id + ') as sub',
                    file_id: tmp.upload_status.file_id,
                    return_model: true,
                }

                if (debugMode) {
                    console.log('\n\n\n');
                    console.log('Layer options POSTed to ', endpoints.tiles.create, '[pile]:');
                    console.log('------------------------------------------')
                    console.log(layer);
                }
                
                api.post(endpoints.tiles.create)
                .send(layer)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = res.body;

                    if (debugMode) {
                        console.log('\n\n\n');
                        console.log('Layer returned from', endpoints.tiles.create, '[pile]:');
                        console.log('------------------------------------------')
                        console.log(status);
                    }

                    expect(status.layerUuid).to.exist;
                    expect(status.options.layer_id).to.exist;
                    expect(status.options.file_id).to.be.equal(tmp.upload_status.file_id);
                    expect(status.options.data_type).to.be.equal('raster');

                    tmp.raster_layer = status;

                    done();
                });
            });
        });


        it('should get expected raster-tile from raster', function (done) {
            this.timeout(40000);
            token(function (err, access_token) {

                var type = 'png';
                var tile = [7,67,37];
                var subdomain = config.servers.tiles.uri;
                var layer_id = tmp.raster_layer.options.layer_id;
                var tiles_url = subdomain.replace('{s}', config.servers.tiles.subdomains[0]);
                tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
                // files (todo: cleanup)
                var expected = 'test/open-data/snow.raster.tile-7-65-35.expected.png';
                var actual = 'test/tmp/test-tile.png'

                http.get({
                    url : tiles_url
                }, actual, function (err, result) {
                    if (err) return done(err);

                    var e = fs.readFileSync(actual);
                    var a = fs.readFileSync(expected);
                    assert.ok(Math.abs(e.length - a.length) < 100);
                    done();
                });
            });
        }); 


        it('should vectorize', function (done) {
            this.timeout(121000);
            token(function (err, access_token) {
                api.post(endpoints.data.vectorize)
                .send({file_id : tmp.upload_status.file_id, access_token : access_token})
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = res.body;
                    
                    tmp.vectorized_status = status;
                    
                    if (debugMode) {
                        console.log('\n\n\n');
                        console.log('Dataset returned from', endpoints.data.vectorize, '[pile]:');
                        console.log('------------------------------------------')
                        console.log(status);
                    }

                    expect(status.user_id).to.exist;
                    expect(status.file_id).to.exist;
                    expect(status.filename).to.be.equal(tmp.upload_status.filename);
                    expect(status.status).to.be.equal('Processing');
                    expect(status.data_type).to.be.equal('vector');
                    expect(status.source.type).to.be.equal('raster:vectorized');
                    done();
                });
            })
        });



        it('should be vectorized without errors', function (done) {
            this.timeout(121000);
            
            // check for processing status
            token(function (err, access_token) {
                var processingInterval = setInterval(function () {
                    process.stdout.write('.');
                    api.get(endpoints.import.status)
                    .query({ file_id : tmp.vectorized_status.file_id, access_token : access_token})
                    .end(function (err, res) {
                        if (err) return done(err);

                        var status = helpers.parse(res.text);

                        // manual assert
                        if (!status.processing_success) return;

                        if (!status.user_id) return done('user_id');
                        if (!status.file_id) return done('file_id');
                        if (status.filename != tmp.vectorized_status.filename) return done('filename');
                        if (status.data_type != 'vector') return done('data_type');
                        if (status.source.type != 'raster:vectorized') return done('source.type');

                        // all good!
                        clearInterval(processingInterval);
                        tmp.vectorized_status = status;
                        done();
                    });
                }, 500);
            });
        });

        it('should create a vector layer', function (done) {
            this.timeout(40000);
            token(function (err, access_token) {

                var layer = {
                    geom_column: 'the_geom_3857',
                    geom_type: 'geometry',
                    raster_band: '',
                    srid: '',
                    affected_tables: '',
                    interactivity: '',
                    attributes: '',
                    access_token: access_token,
                    cartocss_version: '2.0.1',
                    cartocss : '#layer { polygon-fill: yellow; polygon-opacity: 0.5; }',
                    sql: '(SELECT * FROM ' + tmp.vectorized_status.file_id + ') as sub',
                    file_id: tmp.vectorized_status.file_id,
                    return_model: true,
                }
                
                api.post(endpoints.tiles.create)
                .send(layer)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = res.body;

                    if (debugMode) {
                        console.log('\n\n\n');
                        console.log('Layer returned from', endpoints.tiles.create, '[pile]:');
                        console.log('------------------------------------------')
                        console.log(status);
                    }

                    expect(status.layerUuid).to.exist;
                    expect(status.options.layer_id).to.exist;
                    expect(status.options.file_id).to.be.equal(tmp.vectorized_status.file_id);
                    expect(status.options.data_type).to.be.equal('vector');

                    tmp.vector_layer = status;

                    done();
                });
            });
        });


        it('should get expected raster-tile from vectorized raster', function (done) {
            this.timeout(40000);
            token(function (err, access_token) {

                var type = 'png';
                var tile = [7,67,37];
                var subdomain = config.servers.tiles.uri;
                var layer_id = tmp.vector_layer.options.layer_id;
                var tiles_url = subdomain.replace('{s}', config.servers.tiles.subdomains[0]);
                tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
                // files (todo: cleanup)
                var expected = 'test/open-data/vectorized-tile.expected.png';
                var actual = 'test/tmp/vectorized-test-tile.png'

                http.get({
                    url : tiles_url
                }, actual, function (err, result) {
                    if (err) return done(err);

                    var e = fs.readFileSync(actual);
                    var a = fs.readFileSync(expected);
                    assert.ok(Math.abs(e.length - a.length) < 100);
                    done();
                });
            });
        }); 

        it('should get expected vector-tile from vectorized raster', function (done) {
            this.timeout(40000);
            token(function (err, access_token) {
                https://tiles-txa.systemapic.com/v2/tiles/layer_id-93aa971e-8fb2-47f4-913c-00157555a2db/10/570/234.pbf?access_token=pk.8FhhB90ax6KkQmoK0AMePd0R6IlkxM4VAGewsXw8
                var type = 'pbf';
                // var tile = [7,67,37];
                var tile = [10,570,234];
                var subdomain = config.servers.tiles.uri;
                // var layer_id = tmp.vector_layer.options.layer_id;
                var layer_id = 'layer_id-0de35268-a062-4e53-a384-c5157dc5feaa';
                var tiles_url = subdomain.replace('{s}', config.servers.tiles.subdomains[0]);
                tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
                // files (todo: cleanup)
                var expected = 'test/open-data/vectorized-tile.expected.pbf';
                var actual = 'test/tmp/vectorized-test-tile.pbf'

                http.get({
                    url : tiles_url
                }, actual, function (err, result) {
                    if (err) return done(err);

                    var e = fs.readFileSync(actual);
                    var a = fs.readFileSync(expected);
                    assert.ok(Math.abs(e.length - a.length) < 100);
                    done();
                });
            });
        }); 

    });


});
