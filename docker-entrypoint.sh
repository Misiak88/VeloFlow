#!/bin/sh
set -e

# Generate config.js from environment variable
if [ -z "$MAPBOX_TOKEN" ]; then
  echo "ERROR: MAPBOX_TOKEN environment variable is not set" >&2
  exit 1
fi

cat > /usr/share/nginx/html/config.js <<EOF
const MAPBOX_TOKEN = '${MAPBOX_TOKEN}';
EOF

exec nginx -g 'daemon off;'
