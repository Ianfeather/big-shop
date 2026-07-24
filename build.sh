#!/usr/bin/env bash

set -e

check_drift() {
	local committed_file=$1 regen_cmd=$2 regen_hint=$3
	echo "Checking $committed_file is up to date..."
	if ! diff -u "$committed_file" <(eval "$regen_cmd"); then
		echo "$committed_file is out of date. Regenerate it with:"
		echo "  $regen_hint"
		exit 1
	fi
}

npm run package
cd netlify-functions/recipes
go fmt ./...
go test ./... -v

check_drift ../../docs/openapi.yaml "go run . openapi" \
	"cd netlify-functions/recipes && go run . openapi > ../../docs/openapi.yaml"

cd ../..

check_drift types/api.d.ts "npx openapi-typescript docs/openapi.yaml" \
	"npm run generate:api-types"
