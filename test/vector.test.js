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

var tmp = {};

describe('Raster', function () {
    this.slow(400);

    
    context('GeoTIFF (snow-raster.tif)', function () {
        this.timeout(11000);


        it('should upload', function (done) {
            token(function (err, access_token) {
            api.post(endpoints.import.post)
                .type('form')
                .field('access_token', access_token)
                .field('data', fs.createReadStream(path.resolve(__dirname, './snow-raster.tif')))
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var result = res.body;
                   
                    expect(result.file_id).to.exist;
                    expect(result.user_id).to.exist;
                    expect(result.upload_success).to.exist;
                    expect(result.filename).to.be.equal('snow-raster.tif');
                    expect(result.status).to.be.equal('Processing');

                    // status example:
                    // ---------------
                    // { file_id: 'file_viytughyzvngwxtgfmph',
                    // user_id: 'user-0eec3893-3ac0-4d97-9cf2-694a20cbd5d6',
                    // filename: 'snow-raster.tif',
                    // timestamp: 1457805145173,
                    // status: 'Processing',
                    // size: 1573508,
                    // upload_success: true,
                    // error_code: null,
                    // error_text: null,
                    // data_type: 'raster' }

                    tmp.file_id = result.file_id;
                    
                    done();
                });
            });
        });

        it('should have a status', function (done) {
            token(function (err, access_token) {
                api.get(endpoints.import.status)
                .query({file_id : tmp.file_id, access_token : access_token})
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var result = helpers.parse(res.text);

                    expect(result.file_id).to.exist;
                    expect(result.user_id).to.exist;
                    expect(result.upload_success).to.exist;
                    expect(result.upload_success).to.be.true;
                    expect(result.filename).to.be.equal('snow-raster.tif');
                    expect(result.status).to.be.equal('Processing');
                    done();
                });
            });
        });

        it('should process', function (done) {
            this.timeout(10000);
            this.slow(5000);
            var recheckInterval = 500;

            // check for processing status
            token(function (err, access_token) {
                var processingInterval = setInterval(function () {
                    process.stdout.write('.');
                    api.get(endpoints.import.status)
                    .query({ file_id : tmp.file_id, access_token : access_token})
                    .end(function (err, res) {
                        if (err) return done(err);

                        var status = helpers.parse(res.text);

                        if (status.processing_success) {
                            clearInterval(processingInterval);
                            done();
                        }
                    });
                }, recheckInterval);
            });

        });

        it('should be processed without errors', function (done) {
            token(function (err, access_token) {
                api.get(endpoints.import.status)
                .query({file_id : tmp.file_id, access_token : access_token})
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    var status = helpers.parse(res.text);

                    expect(status.upload_success).to.exist;
                    expect(status.status).to.be.equal('Done');
                    expect(status.filename).to.be.equal('snow-raster.tif');
                    expect(status.error_code).to.be.null;
                    expect(status.error_text).to.be.null;
                    done();
                });
            })
        });

        it('should be vectorized', function (done) {
            this.timeout(121000);
            token(function (err, access_token) {
                api.post(endpoints.data.vectorize)
                .send({file_id : tmp.file_id, access_token : access_token})
                .expect(httpStatus.OK)
                .end(function (err, res) {
                    if (err) return done(err);

                    // { 
                    //     __v: 0,
                    //     lastUpdated: '2016-03-12T18:12:38.068Z',
                    //     created: '2016-03-12T18:12:38.068Z',
                    //     name: 'Vectorized raster',
                    //     createdBy: 'user-0eec3893-3ac0-4d97-9cf2-694a20cbd5d6',
                    //     uuid: 'file_kgsyakymyzkhczjctdor',
                    //     _id: '56e45c16f6f1f7c82c8a6dab',
                    //     data: { 
                    //         postgis: { 
                    //             database_name: 'vkztdvcqkm',
                    //             table_name: 'vectorized_raster_oswlleaxrkbnjbqzkdot',
                    //             data_type: 'vector',
                    //             original_format: 'raster' 
                    //         } 
                    //     },
                    //     styleTemplates: [],
                    //     keywords: [] 
                    // }

                    var status = res.body;

                    expect(status.data).to.exist;
                    expect(status.data.postgis).to.exist;
                    expect(status.data.postgis.data_type).to.be.equal('vector');
                    expect(status.data.postgis.original_format).to.be.equal('raster');
                    done();
                });
            })
        });





    });





});
