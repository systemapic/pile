#!/bin/bash

# source config
source /mapic/config/env.sh || exit 1

# TODO: find a better way ?
export SYSTEMAPIC_PGSQL_USERNAME \
       SYSTEMAPIC_PGSQL_PASSWORD \
       SYSTEMAPIC_PGSQL_DBNAME

# ensure log folder
mkdir -p /mapic/modules/mile/log

# ensure node modules are installed
NODE_MODULES_DIR=/mapic/modules/mile/node_modules
if [ ! -d "$NODE_MODULES_DIR" ]; then
  echo "Installing node modules..."
  npm install --silent || abort "Failed to install node modules. Quitting!"
fi

# spin server
if $MAPIC_PRODMODE; then
	echo 'Mile | PostGIS Tile Server | Production mode'
	forever src/pile.js production >> log/pile.log
else
	echo 'Mile Debug mode (with 8GB memory)'
	nodemon --max-old-space-size=8192 -i node_modules/ -i test/ src/pile.js
fi
