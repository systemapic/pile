#!/bin/bash

# REDISCONF="/etc/redis/redis-kue.conf"
# REDISPASS=$(grep "requirepass " $REDISCONF |  sed -r 's/^.{12}//')
# REDISHOST=$(grep "bind" $REDISCONF | grep -v "#" | sed -r 's/^.{5}//')
# REDISPORT=$(grep "port" /etc/redis/redis-kue.conf | grep -v "#" | sed -r 's/^.{5}//')
# REDISDESC="Redis Kue Server"

REDISHOST=kueredis
REDISPASS=9p7bRrd7Zo9oFbxVJIhI09pBq6KiOBvU4C76SmzCkqKlEPLHVR02TN2I40lmT9WjxFiFuBOpC2BGwTnzKyYTkMAQ21toWguG7SZE
REDISPORT=6379

# clear kue redis cache
echo "Flushing rediskue..."
redis-cli -h $REDISHOST -p $REDISPORT -a $REDISPASS flushall



# prod / dev mode
if [ "$1" == "prod" ];then
	PRODUCTIONMODE=true
else 
	PRODUCTIONMODE=false
fi;

# spin server
if $PRODUCTIONMODE; then
	echo 'Pile | PostGIS Tile Server | Production mode'
	forever src/pile.js production >> log/pile.log
else
	echo 'Pile Debug mode'
	nodemon -i node_modules/ -i tests/ src/pile.js
fi
