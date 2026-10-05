.PHONY: install infra setup build dev lint typecheck test test-integration e2e smoke seed loadtest up down eval reembed simulate backfill observability screenshots demo-reset bench-rls quality

install:
	pnpm install

infra:
	../devinfra/start.sh

setup:
	pnpm infra:setup

build:
	pnpm build

dev:
	pnpm dev

lint:
	pnpm lint && pnpm format:check

typecheck:
	pnpm typecheck

test:
	pnpm test

test-integration:
	pnpm test:integration

e2e: build
	pnpm test:e2e

smoke:
	pnpm smoke

seed:
	pnpm seed -- --reset

loadtest:
	k6 run infra/k6/collector-ramp.js

up:
	docker compose up --build

down:
	docker compose down -v

eval:
	pnpm eval:creatives

reembed:
	pnpm reembed

simulate:
	pnpm --filter @cip/simulator exec node dist/main.js run --rate 10 --duration 600

backfill:
	pnpm --filter @cip/simulator exec node dist/main.js backfill --days=90

observability:
	scripts/observability.sh start

screenshots:
	node scripts/screenshots.mjs smoke

demo-reset:
	pnpm demo:reset -- --yes

bench-rls:
	pnpm bench:rls

quality:
	pnpm quality:audit
