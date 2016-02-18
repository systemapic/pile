#!/bin/bash

if [ -z "$2" ]; then
	echo "Usage: $0 <database> <table> [<column>]"
	exit 1
fi

DATABASE=$1
TABLE=$2
COL=the_geom_3857
test -n "$3" && COL="$3"

# get config
source /systemapic/config/env.sh || exit 1

export PGPASSWORD=$SYSTEMAPIC_PGSQL_PASSWORD
export PGUSER=$SYSTEMAPIC_PGSQL_USERNAME
export PGHOST=postgis
export PGDATABASE=$DATABASE

cat<<EOF | psql
SELECT ST_AsGeoJSON(ST_EXTENT("$COL"::geometry)) FROM "$TABLE";
EOF
