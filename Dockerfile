# syntax=docker/dockerfile:1
#
# dev-perf — a CLI tool that measures developer contributions to git
# repositories. The image carries the compiled CLI plus the runtime
# prerequisites: Node.js (the runtime), git (the deterministic analysis
# shells out to it), bash and the core shell utilities (the in-process
# LLM agent runs its commands through bash, which is prompt-controlled
# but not hardened against the analyzed repository — see the README).
#
# The runtime dependency set is pure JavaScript (the one native-looking
# dependency, @silvia-odwyer/photon-node, is a WASM module), so the same
# image builds unchanged for every architecture buildx targets.

# --- Stage: build ------------------------------------------------------------
FROM node:24-bookworm AS builder

# Corepack pins the exact pnpm version from package.json
# (packageManager: pnpm@10.14.0), so the install matches CI.
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

WORKDIR /app

# Install dependencies first: the layer is cached until the lockfile or
# the manifest changes, so rebuilds only pay for the npm resolution once.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the sources and build the CLI (TypeScript into build/).
COPY . .
RUN pnpm build

# Drop the devDependencies so the runtime image ships production
# dependencies only (keeps the image small and the supply-chain surface
# minimal).
RUN pnpm prune --prod

# --- Stage: runtime ----------------------------------------------------------
# Debian slim: includes bash and the core shell utilities the LLM agent
# relies on out of the box; git and ca-certificates are added here.
FROM node:24-bookworm-slim

# dev-perf clones repositories and reads commit history straight from
# git, and its in-process LLM agent runs commands through bash: git and
# ca-certificates are required, and file/ripgrep complete the shell tool
# set the agent is told is available (grep is present as a fallback) —
# all must be in the container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git file ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Default working directory: relative --output paths (report.json,
# compile output) land here, and a .env in it is picked up at startup.
# The node user owns it so `--output` files can be written without root.
WORKDIR /work
RUN mkdir -p /work && chown node:node /work

# The compiled CLI (including the LLM prompt templates under
# build/llm/prompts/), the production dependency set, and package.json
# (version.ts reads the version field from it at runtime).
COPY --from=builder /app/build /app/build
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json

# Expose dev-perf as a top-level command, like the npm bin.
RUN ln -s /app/build/index.js /usr/local/bin/dev-perf

# Run as the non-root `node` user: dev-perf clones untrusted repositories
# and its unshielded LLM `bash` tool can execute commands in them, so it
# must not run with root privileges inside the container.
USER node

ENTRYPOINT ["dev-perf"]
# Bare `docker run` (no arguments) prints help instead of failing.
CMD ["--help"]
