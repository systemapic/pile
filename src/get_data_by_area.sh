#!/bin/bash


if [ "$1" == "" ]; then
	echo "Must provide database as first argument,"
	echo ""
	exit 1 # missing args
fi

if [ "$2" == "" ]; then
	echo "Must provide table as second argument,"
	echo ""
	exit 1 # missing args
fi

if [ "$3" == "" ]; then
	echo "Must provide geojson as third argument,"
	echo ""
	exit 1 # missing args
fi


# PGPASSWORD=docker psql -U docker -d $1 -h postgis -c "SELECT ST_EXTENT(the_geom_3857) FROM $2;"
# PGPASSWORD=docker psql -U docker -d $1 -h postgis -c "select row_to_json(t) from (select * from $2 where $3 = $4) t;"
echo $2
echo $3

PGPASSWORD=docker psql -U docker -d $1 -h postgis -c "select row_to_json(t) from (select * from $2 where st_intersects(st_transform(st_setsrid(ST_geomfromgeojson('$3'), 4326), 3857), $2.geom)) as t;"


# works!
# select row_to_json(t) from (select * from file_qjebdihngbhsoucdwwfl where st_intersects(st_transform(st_setsrid(ST_geomfromgeojson('{"type":"Polygon","coordinates":[[[42.56236553192139,37.96026293121387],[42.56258010864258,37.960165652451245],[42.5629985332489,37.95957774762163],[42.56308972835541,37.95940856550367],[42.5631058216095,37.95926898996297],[42.562912702560425,37.959137873304314],[42.56252110004425,37.9590532817874],[42.561931014060974,37.9590828888294],[42.561678886413574,37.959137873304314],[42.56154477596283,37.95921823515514],[42.56145358085632,37.959319744735744],[42.561437487602234,37.95942548373303],[42.56181299686431,37.959861126796085],[42.562150955200195,37.9601318163297],[42.56202757358551,37.96030522628786],[42.56236553192139,37.96026293121387]]]}'), 4326), 3857), file_qjebdihngbhsoucdwwfl.geom)) as t;