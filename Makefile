.DEFAULT_GOAL := help
.PHONY: help install build test check java-build typescript-build java-test typescript-test java-check typescript-check verify-migration verify-api

help:
	@echo 'make install          Install existing npm dependencies for both SDKs'
	@echo 'make build            Build both SDKs independently'
	@echo 'make test             Run Java and TypeScript unit tests'
	@echo 'make check            Verify history, all local checks, package, and public API'
	@echo 'make java-check       Check Java, Greenfield worker, and local PET WASM'
	@echo 'make typescript-check Check TypeScript, worker, and packed consumer'
	@echo 'make verify-migration Verify original refs and exact SDK source trees'
	@echo 'make verify-api       Compare built APIs with the Phase 2 baseline'

install:
	npm ci --prefix sdks/java/tools/greenfield
	npm ci --prefix sdks/typescript
	npm ci --prefix sdks/typescript/tools/greenfield

java-build:
	cd sdks/java && ./gradlew assemble generatePomFileForMavenJavaPublication --console=plain

typescript-build:
	npm --prefix sdks/typescript run build

build: java-build typescript-build

java-test:
	cd sdks/java && ./gradlew test --console=plain

typescript-test:
	npm --prefix sdks/typescript test

test: java-test typescript-test

java-check:
	cd sdks/java && ./gradlew test assemble examplesClasses generatePomFileForMavenJavaPublication --console=plain
	npm --prefix sdks/java/tools/greenfield test
	npm --prefix sdks/java/tools/greenfield run test:pet-wasm

typescript-check:
	npm --prefix sdks/typescript run check
	npm --prefix sdks/typescript run check:package

verify-migration:
	python3 scripts/verify-migration.py

verify-api:
	python3 scripts/verify-public-api.py

# Keep API comparison after both builds even when make is invoked with -j.
check: verify-migration java-check typescript-check
	python3 scripts/verify-public-api.py
