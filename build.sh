#!/usr/bin/env bash

set -e

npm run package
cd netlify-functions/recipes
go fmt ./...
go test ./... -v

echo "Checking docs/openapi.yaml is up to date with app.go..."
if ! diff -u ../../docs/openapi.yaml <(go run . openapi); then
	echo "docs/openapi.yaml is out of date. Regenerate it with:"
	echo "  cd netlify-functions/recipes && go run . openapi > ../../docs/openapi.yaml"
	exit 1
fi

cd ../..

echo "Checking types/api.d.ts is up to date with docs/openapi.yaml..."
if ! diff -u types/api.d.ts <(npx openapi-typescript docs/openapi.yaml); then
	echo "types/api.d.ts is out of date. Regenerate it with:"
	echo "  npm run generate:api-types"
	exit 1
fi
