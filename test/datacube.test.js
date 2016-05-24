var assert = require('assert');
var mongoose = require('mongoose');
var async = require('async');
var fs = require('fs-extra');
var crypto = require('crypto');
var request = require('request');
var supertest = require('supertest');
var api = supertest('https://' + process.env.SYSTEMAPIC_DOMAIN);
var path = require('path');
var httpStatus = require('http-status');
var chai = require('chai');
var expect = chai.expect;
var http = require('http-request');
var assert = require('assert');
var moment = require('moment');

// helpers
var endpoints = require(__dirname + '/utils/endpoints');
var helpers = require(__dirname + '/utils/helpers');
var token = helpers.token;

// config
var config = require(process.env.WU_CONFIG_PATH || '/systemapic/config/wu-config.js').clientConfig;

// logs
var debugMode = process.env.SYSTEMAPIC_DEBUG;
var debugMode = false; // override

var tmp = {};

// Avoids DEPTH_ZERO_SELF_SIGNED_CERT error for self-signed certs
// See https://github.com/systemapic/pile/issues/38
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// helper fn for tile url
function base_cubes_url() {
    var subdomain = config.servers.cubes.uri;
    var tiles_url = subdomain.replace('{s}', config.servers.cubes.subdomains[0]);
    return tiles_url;
}

function get_default_cartocss() {
    // raster style
    var defaultCartocss = '';
    defaultCartocss += '#layer {'
    defaultCartocss += 'raster-opacity: 1; '; 
    defaultCartocss += 'raster-colorizer-default-mode: linear; '; 
    defaultCartocss += 'raster-colorizer-default-color: transparent; '; 
    defaultCartocss += 'raster-comp-op: color-dodge;';
    defaultCartocss += 'raster-colorizer-stops: '; 
    defaultCartocss += '  stop(20, rgba(0,0,0,0)) '; 
    defaultCartocss += '  stop(21, #dddddd) '; 
    defaultCartocss += '  stop(100, rgba(6, 255, 63, 0.1)) '; 
    defaultCartocss += '  stop(200, rgba(6, 255, 63, 1.0)) '; 
    defaultCartocss += '  stop(255, rgba(0,0,0,0), exact); '; 
    defaultCartocss += ' }';
    return defaultCartocss;
}


describe('Cubes', function () {
    this.slow(400);

    before(function(done) {

        async.series([
            helpers.ensure_test_user_exists,
            helpers.create_project
        ], done);

    });

    after(function (done) {
        helpers.delete_project(done);
    });


    // [pile]
    // ------
    // 1. post to API to create an empty datacube
    // 2. upload dataset (raster) normally
    // 3. add uploaded dataset uuid to datacube
    // 4. set styling, png quality, other options to datacube, which will be common for all datasets
    // 5. request tile from datacube - with correct styling, correct dataset, etc.
    
    // [wu]
    // ----
    // (in client, showing a datacube means adding each layer in separate overlay and doing anim etc.)
    // 1. create a Wu.Cubelayer
    // 2. add pile-cube to wu-cube
    // 3. request tiles 

    // problems:
    // - how to decide the order of datasets? update with new order; order of dataset array decides.
    // - how to add timeseries metadata (like dates) to cube? use a generic text field for metadata + a date field.
    // - how to use same style on all layers in cube? request tiles at /cube/ with array number
    // - how to make all of this easy for globesar? create scripts for uploading, adding to cube. simple GUI for choosing style. 


    // configs modified:
    // - nginx (/v2/cubes route)
    // - wu (cubes tile requests)


    // TODO:
    // - add error handling/tests
    // - tiles for different styles, qualities
    // - add cube to project [wu]
    // - get tiles from disk if already exists (problem: what if cube options have changed?? currently same cube_id even if changed options. this won't reflect in cached tiles...)


    context("ain't nuttin to fuck with", function () {

        it('should create empty cube @ ' + endpoints.cube.create, function (done) {
            token(function (err, access_token) {
                
                // test data, no default options required
                var data = {access_token : access_token};

                api.post(endpoints.cube.create)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.exist;
                    tmp.created_empty = cube;
                    done();
                });
            });
        });

        it('create cube with a dataset @ ' + endpoints.cube.create, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    datasets : ['dataset-uuid-random']
                }

                api.post(endpoints.cube.create)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.exist;
                    expect(cube.datasets).to.have.lengthOf(1);
                    expect(data.datasets[0]).to.be.oneOf(cube.datasets);
                    tmp.created_with_dataset = cube;
                    done();
                });
            });
        });

        it('get cube by cube_id @ ' + endpoints.cube.get, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id
                }

                api.get(endpoints.cube.get)
                .query(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    done();
                });
            });
        });

        it('add dataset @ ' + endpoints.cube.add, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    datasets : [{
                        id : 'random-uuid-1',
                        description : 'meta text',
                        timestamp : 'date as string'
                    },
                    {
                        id : 'random-uuid-2',
                        description : 'meta text',
                        timestamp : 'date as string'
                    }]
                };

                api.post(endpoints.cube.add)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.datasets).to.have.lengthOf(2);
                    expect(cube.datasets[0].id).to.equal(data.datasets[0].id);
                    expect(cube.datasets[0].description).to.equal(data.datasets[0].description);
                    expect(cube.datasets[0].timestamp).to.equal(data.datasets[0].timestamp);
                    done();
                });
            });
        });

        it('remove dataset @ ' + endpoints.cube.remove, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    datasets : [{
                        id : 'random-uuid-1',
                    },
                    {
                        id : 'random-uuid-2',
                    }]
                }

                api.post(endpoints.cube.remove)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.datasets).to.have.lengthOf(0);
                    done();
                });
            });
        });

        it('update cube @ ' + endpoints.cube.update, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    style : get_default_cartocss(),
                    quality : 'png8'
                }

                api.post(endpoints.cube.update)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.style).to.equal(data.style);
                    expect(cube.quality).to.equal(data.quality);
                    done();
                });
            });
        });

        it('upload dataset @ ' + endpoints.import.post, function (done) {
            token(function (err, access_token) {
                api.post(endpoints.import.post)
                .type('form')
                .field('access_token', access_token)
                // .field('data', fs.createReadStream(path.resolve(__dirname, './open-data/snow.raster.200.tif')))
                .field('data', fs.createReadStream(path.resolve(__dirname, './open-data/snow_scandinavia_jan.tif')))
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var status = res.body;
                    debugMode && console.log(status);
                    expect(status.file_id).to.exist;
                    expect(status.user_id).to.exist;
                    expect(status.upload_success).to.exist;
                    expect(status.filename).to.be.equal('snow_scandinavia_jan.tif');
                    expect(status.status).to.be.equal('Processing');
                    tmp.uploaded_raster = status;
                    done();
                });
            });
        });

        it('upload second dataset @ ' + endpoints.import.post, function (done) {
            token(function (err, access_token) {
                api.post(endpoints.import.post)
                .type('form')
                .field('access_token', access_token)
                // .field('data', fs.createReadStream(path.resolve(__dirname, './open-data/snow.raster.2.200.tif')))
                .field('data', fs.createReadStream(path.resolve(__dirname, './open-data/snow_scandinavia_july.tif')))
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var status = res.body;
                    debugMode && console.log(status);
                    expect(status.file_id).to.exist;
                    expect(status.user_id).to.exist;
                    expect(status.upload_success).to.exist;
                    expect(status.filename).to.be.equal('snow_scandinavia_july.tif');
                    expect(status.status).to.be.equal('Processing');
                    tmp.uploaded_raster_2 = status;
                    done();
                });
            });
        });

        it('add dataset to cube @ ' + endpoints.cube.add, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    datasets : [{
                        id : tmp.uploaded_raster.file_id,
                        description : 'Filename: ' + tmp.uploaded_raster.filename,
                        timestamp : moment().format()
                    }]
                }

                api.post(endpoints.cube.add)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.datasets).to.have.lengthOf(1);
                    expect(cube.datasets[0].id).to.equal(data.datasets[0].id);
                    expect(cube.datasets[0].description).to.equal(data.datasets[0].description);
                    expect(cube.datasets[0].timestamp).to.equal(data.datasets[0].timestamp);
                    done();
                });
            });
        });

        it('add second dataset to cube @ ' + endpoints.cube.add, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    datasets : [{
                        id : tmp.uploaded_raster_2.file_id,
                        description : 'Filename: ' + tmp.uploaded_raster_2.filename,
                        timestamp : moment().format()
                    }]
                }

                api.post(endpoints.cube.add)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.datasets).to.have.lengthOf(2);
                    expect(cube.datasets[1].id).to.equal(data.datasets[0].id);
                    expect(cube.datasets[1].description).to.equal(data.datasets[0].description);
                    expect(cube.datasets[1].timestamp).to.equal(data.datasets[0].timestamp);
                    done();
                });
            });
        });

        it('should process raster', function (done) {
            this.timeout(10000);
            this.slow(5000);
            token(function (err, access_token) {
                var processingInterval = setInterval(function () {
                    process.stdout.write('.');
                    api.get(endpoints.import.status)
                    .query({ file_id : tmp.uploaded_raster.file_id, access_token : access_token})
                    .end(function (err, res) {
                        if (err) return done(err);
                        var status = helpers.parse(res.text);
                        if (status.processing_success) {
                            clearInterval(processingInterval);
                            debugMode && console.log(status);
                            expect(status.upload_success).to.exist;
                            expect(status.status).to.be.equal('Done');
                            expect(status.filename).to.be.equal('snow_scandinavia_jan.tif');
                            expect(status.error_code).to.be.null;
                            expect(status.error_text).to.be.null;
                            done();
                        }
                    });
                }, 500);
            });
        });

        it('should process second raster', function (done) {
            this.timeout(10000);
            this.slow(5000);
            token(function (err, access_token) {
                var processingInterval = setInterval(function () {
                    process.stdout.write('.');
                    api.get(endpoints.import.status)
                    .query({ file_id : tmp.uploaded_raster_2.file_id, access_token : access_token})
                    .end(function (err, res) {
                        if (err) return done(err);
                        var status = helpers.parse(res.text);
                        if (status.processing_success) {
                            clearInterval(processingInterval);
                            debugMode && console.log(status);
                            expect(status.upload_success).to.exist;
                            expect(status.status).to.be.equal('Done');
                            expect(status.filename).to.be.equal('snow_scandinavia_july.tif');
                            expect(status.error_code).to.be.null;
                            expect(status.error_text).to.be.null;
                            done();
                        }
                    });
                }, 500);
            });
        });

        it('should get expected raster-tile from cube', function (done) {
            this.slow(5000);
            token(function (err, access_token) {
                var type = 'png';
                var tile = [7,67,37]; // oslo
                var cube_id = tmp.created_empty.cube_id;
                var tiles_url = base_cubes_url();
                var dataset_uuid = tmp.uploaded_raster.file_id;
                tiles_url += cube_id + '/' + dataset_uuid + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                var expected = __dirname + '/open-data/expected-cube-tile-1.png';
                var actual = __dirname + '/tmp/cube-tile-1.png'

                http.get({
                    url : tiles_url,
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

        it('should get expected second raster-tile from cube', function (done) {
            this.slow(5000);
            token(function (err, access_token) {
                var type = 'png';
                var tile = [7,67,37]; // oslo
                var cube_id = tmp.created_empty.cube_id;
                var tiles_url = base_cubes_url();
                var dataset_uuid = tmp.uploaded_raster_2.file_id;
                tiles_url += cube_id + '/' + dataset_uuid + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                var expected = __dirname + '/open-data/expected-cube-tile-2.png';
                var actual = __dirname + '/tmp/cube-tile-2.png'  

                http.get({
                    url : tiles_url,
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

        it('cube should contain two datasets', function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id
                }

                api.get(endpoints.cube.get)
                .query(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.datasets).to.have.lengthOf(2);
                    expect(cube.datasets[0].id).to.equal(tmp.uploaded_raster.file_id);
                    expect(cube.datasets[1].id).to.equal(tmp.uploaded_raster_2.file_id);

                    tmp.cube_with_datasets = cube;
                    done();
                });
            });
        });

        it('should create Wu.CubeLayer on [wu]', function (done) {
            token(function (err, access_token) {

                var layer = {
                    access_token : access_token,
                    projectUuid : util.test_project_uuid,
                    data : { cube : tmp.cube_with_datasets },
                    metadata : tmp.uploaded_raster.metadata,
                    title : 'Snow raster cube',
                    description : 'cube layer description',
                    file : 'file-' + tmp.cube_with_datasets.cube_id,
                    style : JSON.stringify(get_default_cartocss()) // save default json style
                }

                api.post('/v2/layers/create')
                .send(layer)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = JSON.parse(res.body.data.cube);
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    expect(cube.datasets).to.have.lengthOf(2);
                    expect(cube.datasets[0].id).to.equal(tmp.uploaded_raster.file_id);
                    expect(cube.datasets[1].id).to.equal(tmp.uploaded_raster_2.file_id);
                    done();
                });
            });
        });
  

        it('should create empty cube @ ' + endpoints.cube.create, function (done) {
            token(function (err, access_token) {
                
                // test data, no default options required
                var data = {access_token : access_token};

                api.post(endpoints.cube.create)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.exist;
                    tmp.created_empty = cube;
                    done();
                });
            });
        });

        it('should add geojson mask @ ' + endpoints.cube.mask, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    mask : {
                        type : 'geojson',
                        mask : '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[9.2230224609375,58.91031927906605],[9.2230224609375,59.6705145897832],[10.6182861328125,59.6705145897832],[10.6182861328125,58.91031927906605],[9.2230224609375,58.91031927906605]]]}}]}',
                    }
                }

                api.post(endpoints.cube.mask)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    done();
                });
            });
        });

        it('should add topojson mask @ ' + endpoints.cube.mask, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    mask : {
                        type : 'topojson',
                        mask : '{"type":"Topology","objects":{"collection":{"type":"GeometryCollection","geometries":[{"type":"Polygon","arcs":[[0]]}]}},"arcs":[[[0,0],[0,9999],[9999,0],[0,-9999],[-9999,0]]],"transform":{"scale":[0.00013954032121962193,0.00007602713378509362],"translate":[9.2230224609375,58.91031927906605]},"bbox":[9.2230224609375,58.91031927906605,10.6182861328125,59.6705145897832]}'
                    }
                }

                api.post(endpoints.cube.mask)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.mask).to.exist;
                    expect(cube.mask).to.equal(data.mask.mask);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    done();
                });
            });
        });


        it('should upload cube-mask.zip', function (done) {
            token(function (err, access_token) {
                api.post(endpoints.import.post)
                .type('form')
                .field('access_token', access_token)
                .field('data', fs.createReadStream(path.resolve(__dirname, 'open-data/cube-mask.zip')))
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    assert.ifError(err);
                    var result = helpers.parse(res.text);
                    assert.ok(result.file_id);
                    assert.ok(result.user_id);
                    assert.ok(result.upload_success);
                    assert.equal(result.filename, 'cube-mask.zip');
                    assert.equal(result.status, 'Processing');
                    assert.ifError(result.error_code);
                    assert.ifError(result.error_text);

                    tmp.cube_mask_file_id = result.file_id;
                    done();
                });
            });
        });

        it('should process', function (done) {       
            this.timeout(11000);     
            this.slow(5000);
            token(function (err, access_token) {
                var processingInterval = setInterval(function () {
                process.stdout.write('.');
                    api.get(endpoints.import.status)
                    .query({ file_id : tmp.cube_mask_file_id, access_token : access_token})
                    .end(function (err, res) {
                        assert.ifError(err);
                        var status = helpers.parse(res.text);
                        if (status.processing_success) {
                            clearInterval(processingInterval);
                            done();
                        }
                    });
                }, 500);
            });
        });

        it('should add mask from existing dataset @ ' + endpoints.cube.mask, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    mask : {
                        type : 'dataset',
                        mask : tmp.cube_mask_file_id,
                    }
                }

                api.post(endpoints.cube.mask)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    done();
                });
            });
        });


        it('should throw on invalid mask @ ' + endpoints.cube.mask, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    mask : {
                        type : 'geojson',
                        mask : 'invalid topojson'
                    }
                }

                api.post(endpoints.cube.mask)
                .send(data)
                .expect(400)
                .end(function (err, res) {
                    if (err) return done(err);
                    var error = res.body;
                    debugMode && console.log(error);
                    expect(error).to.exist;
                    expect(error.error_code).to.exist;
                    expect(error.error).to.exist;
                    done();
                });
            });
        });

        it('should throw on invalid topology type @ ' + endpoints.cube.mask, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                    mask : {
                        type : 'handdrawn',
                        mask : ''
                    }
                }

                api.post(endpoints.cube.mask)
                .send(data)
                .expect(400)
                .end(function (err, res) {
                    if (err) return done(err);
                    var error = res.body;
                    debugMode && console.log(error);
                    expect(error).to.exist;
                    expect(error.error_code).to.exist;
                    expect(error.error).to.exist;
                    done();
                });
            });
        });


        
        it('should remove mask @ ' + endpoints.cube.unmask, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.created_empty.cube_id,
                }

                api.post(endpoints.cube.unmask)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.mask).to.not.exist;
                    expect(cube.cube_id).to.equal(tmp.created_empty.cube_id);
                    done();
                });
            });
        });






        // date stamp for replacing dataset
        var date_stamp = moment().format();

        it('should create empty cube @ ' + endpoints.cube.create, function (done) {
            token(function (err, access_token) {
                
                // test data, no default options required
                var data = {access_token : access_token};

                api.post(endpoints.cube.create)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.exist;
                    tmp.replacing_cube = cube;
                    done();
                });
            });
        });

        it('update cube @ ' + endpoints.cube.update, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.replacing_cube.cube_id,
                    style : get_default_cartocss(),
                    quality : 'png8'
                }

                api.post(endpoints.cube.update)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.replacing_cube.cube_id);
                    expect(cube.style).to.equal(data.style);
                    expect(cube.quality).to.equal(data.quality);
                    done();
                });
            });
        });

        it('add dataset to cube @ ' + endpoints.cube.add, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.replacing_cube.cube_id,
                    datasets : [{
                        id : tmp.uploaded_raster.file_id,
                        description : 'Filename: ' + tmp.uploaded_raster.filename,
                        timestamp : date_stamp
                    }]
                }

                api.post(endpoints.cube.add)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.replacing_cube.cube_id);
                    expect(cube.datasets).to.have.lengthOf(1);
                    expect(cube.datasets[0].id).to.equal(data.datasets[0].id);
                    expect(cube.datasets[0].description).to.equal(data.datasets[0].description);
                    expect(cube.datasets[0].timestamp).to.equal(data.datasets[0].timestamp);
                    done();
                });
            });
        });


        it('should get expected raster-tile from cube', function (done) {
            this.slow(5000);
            token(function (err, access_token) {
                var type = 'png';
                var tile = [7,67,37]; // oslo
                var cube_id = tmp.replacing_cube.cube_id;
                var tiles_url = base_cubes_url();
                var dataset_uuid = tmp.uploaded_raster.file_id;
                tiles_url += cube_id + '/' + dataset_uuid + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                var expected = __dirname + '/open-data/expected-cube-tile-1.png';
                var actual = __dirname + '/tmp/cube-tile-1.png'

                http.get({
                    url : tiles_url,
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

        it('replace dataset in cube @ ' + endpoints.cube.replace, function (done) {
            token(function (err, access_token) {

                // test data
                var data = {
                    access_token : access_token,
                    cube_id : tmp.replacing_cube.cube_id,
                    datasets : [{
                        id : tmp.uploaded_raster_2.file_id,
                        description : 'Filename: ' + tmp.uploaded_raster_2.filename,
                        timestamp : date_stamp,
                        granularity : 'day'
                    }]
                }

                api.post(endpoints.cube.replace)
                .send(data)
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);
                    var cube = res.body;
                    debugMode && console.log(cube);
                    expect(cube.timestamp).to.exist;
                    expect(cube.createdBy).to.exist;
                    expect(cube.cube_id).to.equal(tmp.replacing_cube.cube_id);
                    expect(cube.datasets).to.have.lengthOf(1);
                    expect(cube.datasets[0].id).to.equal(data.datasets[0].id);
                    expect(cube.datasets[0].description).to.equal(data.datasets[0].description);
                    expect(cube.datasets[0].timestamp).to.equal(data.datasets[0].timestamp);
                    done();
                });
            });
        });



        it('should get expected second raster-tile from cube', function (done) {
            this.slow(5000);
            token(function (err, access_token) {
                var type = 'png';
                var tile = [7,67,37]; // oslo
                var cube_id = tmp.replacing_cube.cube_id;
                var tiles_url = base_cubes_url();
                var dataset_uuid = tmp.uploaded_raster_2.file_id;
                tiles_url += cube_id + '/' + dataset_uuid + '/' + tile[0] + '/' + tile[1] + '/' + tile[2] + '.' + type + '?access_token=' + access_token;
                var expected = __dirname + '/open-data/expected-cube-tile-2.png';
                var actual = __dirname + '/tmp/cube-tile-2.png'  

                http.get({
                    url : tiles_url,
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


    });

});
