#!/bin/bash

# source config
source /systemapic/config/env.sh || exit 1

# spin server
if $SYSTEMAPIC_PRODMODE; then
	echo 'Pile | PostGIS Tile Server | Production mode'
	forever src/pile.js production >> log/pile.log
else
	echo 'Pile Debug mode'
	nodemon -i node_modules/ -i tests/ src/pile.js
fi
