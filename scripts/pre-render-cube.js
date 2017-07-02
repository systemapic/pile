//
// Pre-render datasets in Cube layer
//

// require libs
var _ = require('lodash');
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var dir = require('node-dir');
var moment = require('moment');
var supertest = require('supertest');
var JSFtp = require('jsftp');

// require scripts, config
var endpoints = require('./endpoints');
var utils = require('./utils');
var Cube = require('./cube');
var config = require('../config');

// set vars
var token = utils.token;
// var debug = config.debug;
var debug = false;
var args = process.argv;
var ops = [];
var tmp = {};

// set utc
moment.utc(); 

// set api; domain resolution compatible with localhost setup (must run from within Docker container)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0" 
var current_domain = config.domain || process.env.MAPIC_DOMAIN;
var domain = (current_domain == 'localhost') ? 'https://172.17.0.1' : 'https://' + current_domain;
var api = supertest(domain);

// get dataset.json
if (!args[2]) return utils.missing();

// get json options
// var json = require('../' + args[2]);

// ensure settings
// if (!json || !json.options || !json.options.dateformat) return utils.missing();

// helper fn's
function parse_date(f) {
    // get correct date parser
    if (json.options.dateformat == 'x_x_YYYY_DDD') return parse_date_YYYY_DDD(f);
    if (json.options.dateformat == 'x_x_YYYYMMDD') return parse_date_YYYYMMDD(f);
    console.log('Unsupported date format:', json.options.dateformat);
    process.exit(1);
}
function parse_date_YYYY_DDD(f) {
    // f is eg. "SCF_MOD_2014_002.tif"
    var a = f.split('.');
    var b = a[0].split('_');
    var year = b[2];
    var day = b[3];
    var yd = year + '-' + day;
    var date = moment(yd, "YYYY-DDDD");
    return date;
}
function parse_date_YYYYMMDD(f) {
    // f is eg. "SCF_MOD_20150101.tif"
    var a = f.split('.');
    var b = a[0].split('_');
    var dato = b[2];
    var date = moment(dato, "YYYYMMDD");
    return date;
}
function token(done) {
    api
    .get(endpoints.users.token.token)
    .query({
        username : config.username,
        password : config.password
    })
    .send()
    .end(function (err, res) {
        if (err || !res) return done(err || 'No response.');
        var tokens = utils.parse(res.text);
        done(err, tokens);
    });
};

// // connect to ftp
// var ftp = new JSFtp({
//     host: json.ftp.host,
//     port: 21, // defaults to 21
//     user: json.ftp.user, // defaults to "anonymous"
//     pass: json.ftp.pass // defaults to "@anonymous"
// });





// pre-render all datasets in cube
// -------------------------------
// input: 
//          cube_id
//          bounding box?


// get cube
var ops = [];


// check for stored cube
ops.push(function (done) {
    token(function (err, access_token) {

        // test data
        var data = {
            access_token : access_token,
            cube_id : json.options.cube
        }

        api // api request
        .get(endpoints.cube.get)
        .query(data)
        .end(function (err, res) {
            if (err) return done(err);
            var cube = res.body;
            debug && console.log(cube);
            tmp.cube = cube; // save in global
            done && done(err);
        });
    });
});

// // get or create cube; returns err, cube 
// if (json.options.cube) {

//     // check for stored cube
//     ops.push(function (done) {
//         token(function (err, access_token) {

//             // test data
//             var data = {
//                 access_token : access_token,
//                 cube_id : json.options.cube
//             }

//             api // api request
//             .get(endpoints.cube.get)
//             .query(data)
//             .end(function (err, res) {
//                 if (err) return done(err);
//                 var cube = res.body;
//                 debug && console.log(cube);
//                 tmp.cube = cube; // save in global
//                 done && done(err);
//             });
//         });
//     });

// } else {

//     // create cube
//     ops.push(function (callback) {
//         token(function (err, access_token) {

//             // cube options
//             var cube_options = {
//                 title : 'cube-title',
//                 style : Cube.get_default_cartocss(),
//                 options : {
//                     type : json.options.type,
//                     dateformat : json.options.dateformat
//                 },
//                 access_token : access_token
//             }

//             api // api request
//             .post(endpoints.cube.create)
//             .send(cube_options)
//             .end(function (err, res) {
//                 if (err) return done(err);
//                 var cube = res.body;
//                 debug && console.log('Created cube: \n', cube);
//                 tmp.cube = cube;
//                 callback && callback(err);
//             });
//         });
//     });
// }


// // get file list from ftp
// ops.push(function (callback) {

//     // get path
//     tmp.ftp_folder = '/';
//     if (_.size(json.ftp.folder)) {
//         tmp.ftp_folder = json.ftp.folder + tmp.ftp_folder; 
//     }
  
//     // list folder
//     ftp.ls(tmp.ftp_folder, function(err, files) {
//         if (err) return callback(err);

//         var today = moment();
//         var cube = tmp.cube;
//         var datasets = cube.datasets;
//         var ftp_files_to_add = [];

//         // keyBy
//         var ftp_files = _.keyBy(files, 'name');
//         var cube_files = _.keyBy(datasets, 'description');

//         // find files to add; either doesn't exist or are newer than cube versions
//         _.forEach(ftp_files, function (f, key) {

//             // check if not exists
//             var key = key; // eg. 'SCF_MOD_20160622.tif'

//             if (_.has(cube_files, key)) {
//                 // cube already has this ftp file

//                 // get timestamps
//                 var cube_file_timestamp = moment(cube_files[key].lastModified);
//                 var ftp_file_timestamp = moment(f.time);

//                 // check if newer
//                 if (cube_file_timestamp.isBefore(ftp_file_timestamp)) {

//                     console.log('The cube does not have the latest version of file:', key);
                    
//                     // add to array
//                     ftp_files_to_add.push(f);
//                 }

//             } else {

//                 // cube doesnt have this ftp file
//                 console.log('The cube does not have this file:', key);
                
//                 // add to array
//                 ftp_files_to_add.push(f);
//             }

//         });

//         // store globally
//         tmp.ftp_files_to_add = ftp_files_to_add;

//         // done
//         callback(null);
//     });
// });

// // download files from ftp
// ops.push(function (callback) {

//     // // get file
//     tmp.local_folder = '/tmp/ftp/' + tmp.cube.cube_id + '/'; // nb! this is sdk docker folder, not engine/mile /data/!
//     fs.mkdirs(tmp.local_folder, function (err) {
//         if (err) return callback(err);

//         // download from ftp
//         async.eachSeries(tmp.ftp_files_to_add, function (item, done) {

//             // set paths
//             var ftp_file_path = tmp.ftp_folder + item.name;
//             var local_file_path = tmp.local_folder + item.name;

//             console.log('Downloading', ftp_file_path);

//             // get from ftp
//             ftp.get(ftp_file_path, local_file_path, done);

//         }, callback);

//     });
// });

// // read local tmp folder
// ops.push(function (callback) {
//     dir.files(tmp.local_folder, function (err, files) {
//         tmp.upload_files = files;
//         callback(err, files);
//     });
// });

// // ensure files are correct
// ops.push(function (callback) {

//     var invalid = [];

//     // check for valid date formats
//     tmp.upload_files.forEach(function (f) {

//         // get filename
//         var filename = path.basename(f);

//         // test date parsing
//         var date = parse_date(filename);

//         // check if valid moment
//         var isValid = date.isValid(); 

//         // gather invalid moments
//         if (!isValid) invalid.push(filename);
//     });

//     // catch errors
//     if (_.size(invalid)) {

//         // log
//         console.log('Some filenames could not be parsed to dates. Aborting!');
//         console.log('Invalid filenames:', invalid);

//         // quit
//         return process.exit(1);
//     }

//     // all good, continue
//     callback();
// });

// // upload to API
// ops.push(function (callback) {
//     var files = tmp.upload_files;
//     tmp.uploaded = [];

//     // upload each dataset
//     async.eachSeries(files, function (file, done) {

//         // upload data
//         Cube.upload_data({
//             path : file
//         }, function (err, result) {

//             // catch errors
//             if (err) return done(err);

//             // parse
//             if (result.error) return done(result.error);

//             // remember
//             tmp.uploaded.push(result);

//             // log
//             console.log('Uploaded', result.filename);

//             // return
//             done(null);

//         });
//     }, callback);
// });
 

// // replace datasets in cube
// ops.push(function (callback) {
//     var sets = [];

//     // create dataset array
//     tmp.uploaded.forEach(function (up) {
//         sets.push({
//             id : up.file_id,
//             description : up.filename,
//             timestamp : parse_date(up.filename).format(),
//             granularity : 'day'
//         });
//     });

//     // dont update if no changes
//     if (!_.size(sets)) return callback('No changes.');

//     console.log('Replacing', _.size(tmp.cube.datasets), 'datasets.');

//     // add dataset to cube
//     Cube.replace_datasets({
//         cube_id : tmp.cube.cube_id,
//         datasets : sets
//     }, function (err, cube) {
//         if (cube.error) return callback(cube.error);
//         tmp.updated_cube = cube;
//         callback(err);
//     });

// });


// ops.push(function (callback) {

//     token(function (err, access_token) {

//         var layer = {
//             data : {
//                 cube : JSON.stringify(tmp.updated_cube)
//             },
//             layer : json.options.layer,
//             uuid : json.options.project,
//             access_token : access_token
//         };

//         api // api request
//         .post(endpoints.layers.update)
//         .send(layer)
//         .end(callback);

//     });
// });


// ops.push(function (callback) {
//     token(function (err, access_token) {

//         var cube = tmp.updated_cube || tmp.cube;
//         var masks = cube.masks;

//         console.log('Pre-querying cube.');

//         async.eachSeries(masks, function (m, done) {

//             var query_options = {
//                 query_type : 'scf-geojson',
//                 mask_id : m.id,
//                 year : 2016,
//                 day : 365,
//                 options : {
//                      currentYearOnly : true,
//                      filter_query : false,
//                     force_query : true
//                 },
//                 cube_id : cube.cube_id,
//                 access_token : access_token
//             }

//             api // api request
//             .post(endpoints.cube.query)
//             .send(query_options)
//             .end(done);

//         }, callback);

//     });
// });

// async.series(ops, function (err, result) {
//     console.log('Syncing done!');
//     if (err) console.log(err);
//     process.exit(1);
// });



