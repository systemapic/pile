# Mapic Tileserver [![Build Status](https://travis-ci.org/mapic/mile.png)](https://travis-ci.org/mapic/mile)


## Install
See [mapic/mapic](https://github.com/mapic/mapic) for installation instructions.

## Data formats
Mapic Tileserver uses [PostGIS](http://www.postgis.net/) under the hood for data storage. It can therefore can accept any PostGIS supported format, and can be easily modified to support other output formats.

#### Input sources
- [x] PostGIS
- [ ] Any format, incl. `GeoTIFF`, `GeoJSON`, `TopoJSON`, `Shapefile`

#### Output formats
- [x] Raster tiles (combined with [CartoCSS](https://carto.com/docs/carto-engine/cartocss/) stylesheet)
- [ ] Vector tiles (under development)
- [ ] Untiled vector formats (`GeoJSON`, `TopoJSON`, `Shapefile`)
- [ ] Untiled raster formats (`GeoTIFF`, `ECW`, `JPEG200`, etc.)

## Tests

Tests are meant to be run from within the Docker appropriately
started with all links expected from the [mapic/mapic](https://github.com/mapic/mapic)
configuration.

Inside the Docker container (enter with `./shell-to.sh`), tests are run using:

```sh
 npm test
````


## Licence
Mapic is built entirely open source. We believe in a collaborative environment for creating strong solutions for an industry that is constantly moving. The Mapic platform is open for anyone to use and contribute to, which makes it an ideal platform for government organisations as well as NGO's and for-profit businesses.

Mapic is licenced under the [AGPL licence](https://github.com/mapic/mapic/blob/master/LICENCE).

## Contributors
- [Jørgen Evil Ekvoll](https://github.com/jorgenevil)
- [Magdalini Fotiadou](https://github.com/mft74)
- [Sandro Santilli](https://github.com/strk)
- [Knut Ole Sjøli](https://github.com/knutole)
- [Shahjada Talukdar](https://github.com/destromas1)
- [Igor Ziegler](https://github.com/igorziegler)
