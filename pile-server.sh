#!/bin/bash

if [ "$1" == "prod" ];then
	PRODUCTIONMODE=true
else 
	PRODUCTIONMODE=false
fi;

# spin server
if $PRODUCTIONMODE; then
	echo 'Pile | PostGIS Tile Server | Production mode'
	forever pile.js production >> log/pile.log
else
	echo 'Pile Debug mode'
	nodemon -i node_modules/ -i tests/ pile.js
fi
