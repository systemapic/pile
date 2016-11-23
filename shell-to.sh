#!/bin/bash

function abort() {
	echo $1
	exit 1;
}

test -n "$1" || abort "Usage: $0 <name>"
NAME=$1

# check MAPIC_DOMAIN is set
test -z "$MAPIC_DOMAIN" &&
  abort "Usage: $0 <domain> (or set MAPIC_DOMAIN ENV variable, eg. export MAPIC_DOMAIN=localhost)"

PREFIX=`echo ${MAPIC_DOMAIN} | sed 's/\..*//'`
FULLNAME=${PREFIX}_${NAME}_1
docker exec -ti ${FULLNAME} bash
