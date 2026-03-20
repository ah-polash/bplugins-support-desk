#!/usr/bin/env bash
set -o errexit

npm install --legacy-peer-deps
npx prisma generate
npx prisma db push --skip-generate
npm run build
