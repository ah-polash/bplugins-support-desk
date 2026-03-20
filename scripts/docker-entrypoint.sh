#!/bin/sh
set -e

echo "Running database migrations..."
node node_modules/prisma/build/index.js db push --skip-generate

echo "Running database seed..."
node prisma/seed.js

echo "Starting application..."
exec node server.js
