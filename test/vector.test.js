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
                            done();
                        }
                    });
                }, 500);
            });

        });

        it('should be processed without errors', function (done) {
            token(function (err, access_token) {
                api.get(endpoints.import.status)
                .query({file_id : tmp.upload_status.file_id, access_token : access_token})
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = helpers.parse(res.text);

                    expect(status.upload_success).to.exist;
                    expect(status.status).to.be.equal('Done');
                    expect(status.filename).to.be.equal('snow.raster.200.tif');
                    expect(status.error_code).to.be.null;
                    expect(status.error_text).to.be.null;
                    done();
                });
            })
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

                
                api.post(endpoints.tiles.create)
                .send(layer)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = res.body;
                    // { 
                    //     layerUuid: 'layer_id-db1359d2-cd2b-4627-a816-f4db34bf0bfa',
                    //     options: { 
                    //         layer_id: 'layer_id-db1359d2-cd2b-4627-a816-f4db34bf0bfa',
                    //         sql: '(SELECT * FROM file_jgddsyiwqedvqdvpvias) as sub',
                    //         cartocss: '@point_opacity: 1;\n@marker_size_factor: 2;\n[zoom<10] { marker-width: 0.2 * @marker_size_factor; }\n[zoom=10] { marker-width: 0.3 * @marker_size_factor; }\n[zoom=11] { marker-width: 0.5 * @marker_size_factor; }\n[zoom=12] { marker-width: 1   * @marker_size_factor; }\n[zoom=13] { marker-width: 1   * @marker_size_factor; }\n[zoom=14] { marker-width: 2   * @marker_size_factor; }\n[zoom=15] { marker-width: 4   * @marker_size_factor; }\n[zoom=16] { marker-width: 6   * @marker_size_factor; }\n[zoom=17] { marker-width: 8   * @marker_size_factor; }\n[zoom>=18] { marker-width: 12  * @marker_size_factor; }\n\n#layer {\n\n\tmarker-allow-overlap: true;\n\tmarker-clip: false;\n\tmarker-comp-op: screen;\n\n\tmarker-opacity: @point_opacity;\n\n\tmarker-fill: #12411d;\n\n}',
                    //         file_id: 'file_jgddsyiwqedvqdvpvias',
                    //         table_name: 'file_jgddsyiwqedvqdvpvias',
                    //         data_type: 'vector',
                    //         cartocss_version: '2.0.1',
                    //         geom_column: 'the_geom_3857',
                    //         geom_type: 'geometry',
                    //         raster_band: 0,
                    //         srid: 3857 
                    //     } 
                    // }

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

                // var layer = {
                //     "projectUuid": "project-391a2841-7284-4932-8d58-065a910e881a",
                //     "data": {
                //         "postgis": {
                //             "layer_id": "layer_id-39b17d90-0525-4de1-8f0f-a642b4bd794c",
                //             "sql": "(SELECT * FROM file_pntimdoszkshduickxhp) as sub",
                //             "cartocss": "#layer { raster-opacity:1.0 }",
                //             "file_id": "file_pntimdoszkshduickxhp",
                //             "database_name": "vkztdvcqkm",
                //             "table_name": "file_pntimdoszkshduickxhp",
                //             "metadata": "{\"extent_geojson\":{\"type\":\"Polygon\",\"coordinates\":[[[3.61898984696375,57.6034919970039],[3.61898984696375,64.2036679193228],[12.3357480094751,64.2036679193228],[12.3357480094751,57.6034919970039],[3.61898984696375,57.6034919970039]]]},\"total_area\":346497325610.33765,\"geometry_type\":false,\"size_bytes\":\"984 kB\"}",
                //             "data_type": "raster",
                //             "cartocss_version": "2.0.1",
                //             "geom_column": "rast",
                //             "geom_type": "raster",
                //             "raster_band": 0,
                //             "srid": 3857
                //         }
                //     },
                //     "metadata": "{\"extent_geojson\":{\"type\":\"Polygon\",\"coordinates\":[[[3.61898984696375,57.6034919970039],[3.61898984696375,64.2036679193228],[12.3357480094751,64.2036679193228],[12.3357480094751,57.6034919970039],[3.61898984696375,57.6034919970039]]]},\"total_area\":346497325610.33765,\"geometry_type\":false,\"size_bytes\":\"984 kB\"}",
                //     "title": "SCF_MOD_2014_007",
                //     "description": "Description: Layer created from SCF_MOD_2014_007",
                //     "file": "file_pntimdoszkshduickxhp",
                //     "access_token": "pk.8FhhB90ax6KkQmoK0AMePd0R6IlkxM4VAGewsXw8"
                // }

                // var layer = {
                //     "geom_column": "rast",
                //     "geom_type": "raster",
                //     "raster_band": "",
                //     "srid": "",
                //     "affected_tables": "",
                //     "interactivity": "",
                //     "attributes": "",
                //     "access_token": access_token,
                //     "cartocss_version": "2.0.1",
                //     "cartocss": "#layer { raster-opacity:1.0 }",
                //     "sql": "(SELECT * FROM " + tmp.vectorized_status.file_id + ") as sub",
                //     "file_id": tmp.vectorized_status.file_id,
                //     "return_model": true,
                //     // "projectUuid": "project-391a2841-7284-4932-8d58-065a910e881a",
                //     "cutColor": false
                // }

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
                    // cartocss: '@point_opacity: 1;\n@marker_size_factor: 2;\n[zoom<10] { marker-width: 0.2 * @marker_size_factor; }\n[zoom=10] { marker-width: 0.3 * @marker_size_factor; }\n[zoom=11] { marker-width: 0.5 * @marker_size_factor; }\n[zoom=12] { marker-width: 1   * @marker_size_factor; }\n[zoom=13] { marker-width: 1   * @marker_size_factor; }\n[zoom=14] { marker-width: 2   * @marker_size_factor; }\n[zoom=15] { marker-width: 4   * @marker_size_factor; }\n[zoom=16] { marker-width: 6   * @marker_size_factor; }\n[zoom=17] { marker-width: 8   * @marker_size_factor; }\n[zoom>=18] { marker-width: 12  * @marker_size_factor; }\n\n#layer {\n\n\tmarker-allow-overlap: true;\n\tmarker-clip: false;\n\tmarker-comp-op: screen;\n\n\tmarker-opacity: @point_opacity;\n\n\tmarker-fill: #12411d;\n\n}',
                    cartocss : '#layer { polygon-fill: red; polygon-opacity: 0.5;',
                    sql: '(SELECT * FROM ' + tmp.vectorized_status.file_id + ') as sub',
                    file_id: tmp.vectorized_status.file_id,
                    return_model: true,
                }
                
                api.post(endpoints.tiles.create)
                .send(layer)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = res.body;
                    // { 
                    //     layerUuid: 'layer_id-db1359d2-cd2b-4627-a816-f4db34bf0bfa',
                    //     options: { 
                    //         layer_id: 'layer_id-db1359d2-cd2b-4627-a816-f4db34bf0bfa',
                    //         sql: '(SELECT * FROM file_jgddsyiwqedvqdvpvias) as sub',
                    //         cartocss: '@point_opacity: 1;\n@marker_size_factor: 2;\n[zoom<10] { marker-width: 0.2 * @marker_size_factor; }\n[zoom=10] { marker-width: 0.3 * @marker_size_factor; }\n[zoom=11] { marker-width: 0.5 * @marker_size_factor; }\n[zoom=12] { marker-width: 1   * @marker_size_factor; }\n[zoom=13] { marker-width: 1   * @marker_size_factor; }\n[zoom=14] { marker-width: 2   * @marker_size_factor; }\n[zoom=15] { marker-width: 4   * @marker_size_factor; }\n[zoom=16] { marker-width: 6   * @marker_size_factor; }\n[zoom=17] { marker-width: 8   * @marker_size_factor; }\n[zoom>=18] { marker-width: 12  * @marker_size_factor; }\n\n#layer {\n\n\tmarker-allow-overlap: true;\n\tmarker-clip: false;\n\tmarker-comp-op: screen;\n\n\tmarker-opacity: @point_opacity;\n\n\tmarker-fill: #12411d;\n\n}',
                    //         file_id: 'file_jgddsyiwqedvqdvpvias',
                    //         table_name: 'file_jgddsyiwqedvqdvpvias',
                    //         data_type: 'vector',
                    //         cartocss_version: '2.0.1',
                    //         geom_column: 'the_geom_3857',
                    //         geom_type: 'geometry',
                    //         raster_band: 0,
                    //         srid: 3857 
                    //     } 
                    // }

                    expect(status.layerUuid).to.exist;
                    expect(status.options.layer_id).to.exist;
                    expect(status.options.file_id).to.be.equal(tmp.vectorized_status.file_id);
                    expect(status.options.data_type).to.be.equal('vector');

                    tmp.vector_layer = status;

                    done();
                });
            });
        });


        // todo: something missing form vectorized raster layer or upload_status json...



        it('should get expected raster-tile from raster', function (done) {
            this.timeout(40000);
            token(function (err, access_token) {

                var type = 'png';
                var tile = [7,67,37];
                var subdomain = config.servers.tiles.uri;
                var layer_id = tmp.vector_layer.options.layer_id;
                var tiles_url = subdomain.replace('{s}', config.servers.tiles.subdomains[0]);
                tiles_url += layer_id + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                
                // files (todo: cleanup)
                var expected = 'test/open-data/snow.raster.tile-7-65-35.expected.png';
                var actual = 'test/tmp/test-tile-2.png'

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
