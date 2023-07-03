#!/usr/bin/env bash

set -e

npm run package
cd netlify-functions/recipes
go fmt ./...
go test ./... -v
