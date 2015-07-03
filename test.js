// create vector tile from postgis
//
var GrainStore = require('grainstore');


// fully default.
var mmls = new GrainStore.MMLStore({
	// host : localhost,
	port : 6380
});
var mmlb = mmls.mml_builder({dbname: 'systemapic', table:'africa'}, function(err, payload) {
    mmlb.toXML(function(err, data){
    	console.log(err);
      console.log(data); // => Mapnik XML for your database with default styles
    }); 
});


// // custom redis and pg settings.
// var mmls = new GrainStore.MMLStore(); 

// var render_target = {
//   dbname: 'systemapic', 
//   table:'africa', 
//   sql:'select * from africa'
// }

// // see mml_store.js for more customisation detail 
// var mapnik_config = {
//   Map: {srid: 4326},
//   Datasource: {
//     user: "postgres",
//     geometry_field: "my_geom"
//   }   
// }

// mmlb = mmls.mml_builder(render_target, mapnik_config, function(err, payload) {
//     mmlb.toXML(function(err, data){
//       console.log(data); // => Mapnik XML of custom database with default style
//     }); 
// });



// // custom styles.
// var mmls = new GrainStore.MMLStore();
// var mmlb = mmls.mml_builder({dbname: 'my_database', table:'my_table'},
// function(err, payload)
// {
//     var my_style = "#my_table{marker-fill: #FF6600;}"

//     mmlb.setStyle(my_style, function(err, data){
//       if err throw err; // any Carto Compile errors

//       mmlb.toMML(function(err, data){
// 	console.log(data) // => Carto ready MML
//       }); 

//       mmlb.toXML(function(err, data){
// 	console.log(data); // => Mapnik XML of database with custom style
//       }); 

//       mmlb.getStyle(function(err, data){
// 	console.log(data); // => "#my_table{marker-fill: #FF6600;}"
//       });
//     });
// });