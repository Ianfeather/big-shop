# Production image for the Go API, deployed to Fly.io in `fra`.
#
# Distinct from Dockerfile.dev, which is the full Go toolchain plus `air` for
# hot reload and is what docker-compose.yml and the e2e stack build. This one
# is a static binary on a base image containing nothing else.

FROM golang:1.25-bookworm AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO off so the result is a fully static binary that runs on distroless/static.
# -trimpath keeps build-machine paths out of it; -s -w drop the symbol table and
# DWARF info, which nothing here reads.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/recipes .

# distroless/static ships a CA bundle and tzdata and nothing else - no shell, no
# package manager. The CA bundle is load-bearing: main.go reaches TiDB over TLS
# with a pinned ServerName (gateway01.eu-central-1), which fails without it.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/recipes /usr/local/bin/recipes

# The deployed revision, surfaced as OTel's service.version so a trace can be
# tied to the build that produced it ("is this still happening after the fix?").
# Passed at deploy time:
#   fly deploy ./api --build-arg SERVICE_VERSION=$(git rev-parse --short HEAD)
# Defaults to "unknown" rather than a fake sha: telemetry.version() falls back to
# "dev", and a container claiming to be a dev build is less misleading than one
# claiming to be a commit it isn't.
ARG SERVICE_VERSION=unknown
ENV SERVICE_VERSION=$SERVICE_VERSION

USER nonroot:nonroot

EXPOSE 8080

# `serve` selects main()'s plain http.Server branch - the same one .air.toml
# runs locally, deliberately, so production and local exercise identical code.
# (`dev` is still accepted as the older name for this mode, but a production
# container started by an argument called "dev" reads as a mistake, so it isn't
# used here.) Nothing about this mode disables auth; that is DISABLE_AUTH,
# which is set only in docker-compose.yml.
ENTRYPOINT ["/usr/local/bin/recipes", "serve"]
