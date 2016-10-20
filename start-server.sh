#!/bin/bash

# source config
source /mapic/config/env.sh || exit 1

# TODO: find a better way ?
export SYSTEMAPIC_PGSQL_USERNAME \
       SYSTEMAPIC_PGSQL_PASSWORD \
       SYSTEMAPIC_PGSQL_DBNAME

# spin server
if $SYSTEMAPIC_PRODMODE; then
	echo 'Pile | PostGIS Tile Server | Production mode'
	forever src/pile.js production >> log/pile.log
else
	echo 'Pile Debug mode (with 8GB memory)'
	nodemon --max-old-space-size=8192 -i node_modules/ -i tests/ src/pile.js
fi
