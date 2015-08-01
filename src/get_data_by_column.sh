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
	echo "Must provide key as third argument,"
	echo ""
	exit 1 # missing args
fi

if [ "$3" == "" ]; then
	echo "Must provide value as third argument,"
	echo ""
	exit 1 # missing args
fi


# PGPASSWORD=docker psql -U docker -d $1 -h postgis -c "SELECT ST_EXTENT(the_geom_3857) FROM $2;"
PGPASSWORD=docker psql -U docker -d $1 -h postgis -c "select row_to_json(t) from (select * from $2 where $3 = $4) t;"
