var assert = require('assert');
var mongoose = require('mongoose');
var async = require('async');
var fs = require('fs-extra');
var crypto = require('crypto');
var request = require('request');
var supertest = require('supertest');
var api = supertest('https://' + process.env.SYSTEMAPIC_DOMAIN);
// var endpoints = require('./endpoints.js');
// var helpers = require('./helpers');
// var token = helpers.token;
var path = require('path');
var httpStatus = require('http-status');
var chai = require('chai');
var expect = chai.expect;
var http = require('http-request');
var assert = require('assert');


// helpers
var endpoints = require(__dirname + '/utils/endpoints');
var helpers = require(__dirname + '/utils/helpers');
var token = helpers.token;

// config
var config = require('/mapic/config/engine.config.js').clientConfig;

var tmp = {};

// var debugMode = process.env.SYSTEMAPIC_DEBUG;
var debugMode = false;
if (debugMode) {
    console.log('Debug mode!');
}

// Avoids DEPTH_ZERO_SELF_SIGNED_CERT error for self-signed certs
// See https://github.com/systemapic/pile/issues/38
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function base_tiles_url()
{
  var subdomain = config.servers.tiles.uri;
  var tiles_url = subdomain.replace('{s}', config.servers.tiles.subdomains[0]);
  return tiles_url;
}

describe('Raster', function () {
    this.slow(400);

    before(function(done) {
      helpers.ensure_test_user_exists(done);
    });

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

                            clearInterval(processingInterval);

                            if (debugMode) {
                                console.log('\n\n\n');
                                console.log('Upload status: when done processing', '[wu]:');
                                console.log('------------------------------------------')
                                console.log(status);
                            }

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
                var layer_id = tmp.raster_layer.options.layer_id;
                var tiles_url = base_tiles_url();
                tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
                // files (todo: cleanup)
                var expected = 'test/open-data/snow.raster.tile-7-65-35.expected.png';
                var actual = 'test/tmp/test-tile.png'

                http.get({
                    url : tiles_url,
                    // We don't need ssl validation during tests
                    noSslVerifier : true
                }, actual, function (err, result) {
                    if (err) return done(err);

                    var e = fs.readFileSync(actual);
                    var a = fs.readFileSync(expected);
                    assert.ok(Math.abs(e.length - a.length) < 100);
                    done();
                });
            });
        }); 


        // it('should vectorize', function (done) {
        //     this.timeout(121000);
        //     token(function (err, access_token) {
        //         api.post(endpoints.data.vectorize)
        //         .send({file_id : tmp.upload_status.file_id, access_token : access_token})
        //         .expect(httpStatus.OK)
        //         .end(function (err, res) {
        //             if (err) return done(err);

        //             var status = res.body;
                    
        //             tmp.vectorized_status = status;
                    
        //             if (debugMode) {
        //                 console.log('\n\n\n');
        //                 console.log('Dataset returned from', endpoints.data.vectorize, '[pile]:');
        //                 console.log('------------------------------------------')
        //                 console.log(status);
        //             }

        //             expect(status.user_id).to.exist;
        //             expect(status.file_id).to.exist;
        //             expect(status.filename).to.be.equal(tmp.upload_status.filename);
        //             expect(status.status).to.be.equal('Processing');
        //             expect(status.data_type).to.be.equal('vector');
        //             // expect(status.source.type).to.be.equal('raster:vectorized');
        //             done();
        //         });
        //     })
        // });



        // it('should be vectorized without errors', function (done) {
        //     this.timeout(121000);
            
        //     // check for processing status
        //     token(function (err, access_token) {
        //         var processingInterval = setInterval(function () {
        //             process.stdout.write('.');
        //             api.get(endpoints.import.status)
        //             .query({ file_id : tmp.vectorized_status.file_id, access_token : access_token})
        //             .end(function (err, res) {
        //                 if (err) return done(err);

        //                 var status = helpers.parse(res.text);

        //                 // wait for processing
        //                 if (!status.processing_success) return;

        //                 // manually assert
        //                 if (!status.user_id) return done('user_id');
        //                 if (!status.file_id) return done('file_id');
        //                 if (status.filename != tmp.vectorized_status.filename) return done('filename');
        //                 if (status.data_type != 'vector') return done('data_type');
        //                 // if (status.source.type != 'raster:vectorized') return done('source.type');

        //                 // all good!
        //                 clearInterval(processingInterval);
        //                 tmp.vectorized_status = status;
        //                 done();
        //             });
        //         }, 500);
        //     });
        // });

        // it('should create a vector layer', function (done) {
        //     this.timeout(40000);
        //     token(function (err, access_token) {

        //         var layer = {
        //             geom_column: 'the_geom_3857',
        //             geom_type: 'geometry',
        //             raster_band: '',
        //             srid: '',
        //             affected_tables: '',
        //             interactivity: '',
        //             attributes: '',
        //             access_token: access_token,
        //             cartocss_version: '2.0.1',
        //             cartocss : '#layer { polygon-fill: yellow; polygon-opacity: 0.5; }',
        //             sql: '(SELECT * FROM ' + tmp.vectorized_status.file_id + ') as sub',
        //             file_id: tmp.vectorized_status.file_id,
        //             return_model: true,
        //         }
                
        //         api.post(endpoints.tiles.create)
        //         .send(layer)
        //         .end(function (err, res) {
        //             if (err) return done(err);

        //             var status = res.body;

        //             if (debugMode) {
        //                 console.log('\n\n\n');
        //                 console.log('Layer returned from', endpoints.tiles.create, '[pile]:');
        //                 console.log('------------------------------------------')
        //                 console.log(status);
        //             }

        //             expect(status.layerUuid).to.exist;
        //             expect(status.options.layer_id).to.exist;
        //             expect(status.options.file_id).to.be.equal(tmp.vectorized_status.file_id);
        //             expect(status.options.data_type).to.be.equal('vector');

        //             tmp.vector_layer = status;

        //             done();
        //         });
        //     });
        // });


        // it('should get expected raster-tile from vectorized raster', function (done) {
        //     this.timeout(40000);
        //     token(function (err, access_token) {

        //         var type = 'png';
        //         var tile = [7,67,37];
        //         var layer_id = tmp.vector_layer.options.layer_id;
        //         var tiles_url = base_tiles_url();
        //         tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
        //         // files (todo: cleanup)
        //         var expected = 'test/open-data/vectorized-tile.expected.png';
        //         var actual = 'test/tmp/vectorized-test-tile.png'

        //         http.get({
        //             url : tiles_url,
        //             // We don't need ssl validation during tests
        //             noSslVerifier : true
        //         }, actual, function (err, result) {
        //             if (err) return done(err);

        //             var e = fs.readFileSync(actual);
        //             var a = fs.readFileSync(expected);
        //             assert.ok(Math.abs(e.length - a.length) < 100);
        //             done();
        //         });
        //     });
        // }); 

        // it.skip('should get expected vector-tile from vectorized raster', function (done) {
        //     this.timeout(40000);
        //     token(function (err, access_token) {
        //         if (err) return done(err);
        //         var type = 'pbf';
        //         var tile = [10,570,234];
        //         var tiles_url = base_tiles_url();
        //         var layer_id = tmp.vector_layer.options.layer_id;
        //         var tiles_url = subdomain.replace('{s}', config.servers.tiles.subdomains[0]);
        //         tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
        //         // files (todo: cleanup)
        //         var expected = 'test/open-data/vectorized-tile.expected.pbf';
        //         var actual = 'test/tmp/vectorized-test-tile.pbf'

        //         http.get({
        //             url : tiles_url,
        //             // We don't need ssl validation during tests
        //             noSslVerifier : true
        //         }, actual, function (err, result) {
        //             if (err) return done(err);

        //             var e = fs.readFileSync(actual);
        //             var a = fs.readFileSync(expected);
        //             assert.ok(Math.abs(e.length - a.length) < 100);
        //             done();
        //         });
        //     });
        // }); 

    });


});
