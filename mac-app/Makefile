APP_NAME := Nomendex
APP_DIR := bundle/$(APP_NAME).app

.PHONY: all build clean build-ui build-sidecar build-host package run-host zip release sign notarize sparkle-keys sparkle-release

all: build

build: build-ui build-sidecar build-host package

build-sidecar:
	./scripts/build_sidecar.sh

build-host:
	./scripts/build_host_app.sh

package:
	./scripts/package_app.sh

release: build
	chmod +x ./scripts/sign_and_notarize.sh
	./scripts/sign_and_notarize.sh

# Convenience targets
sign:
	chmod +x ./scripts/sign_and_notarize.sh
	SIGN_ONLY=1 ./scripts/sign_and_notarize.sh

notarize:
	chmod +x ./scripts/sign_and_notarize.sh
	NOTARIZE_ONLY=1 ./scripts/sign_and_notarize.sh

run-host:
	./scripts/build_host_app.sh --run

clean:
	rm -rf build "$(APP_DIR)"

zip:
	(cd .. && zip -r bun-macos-sidecar-starter.zip bun-macos-sidecar-starter)

# Sparkle auto-update targets
sparkle-keys:
	chmod +x ./scripts/generate_sparkle_keys.sh
	./scripts/generate_sparkle_keys.sh

sparkle-release:
	chmod +x ./scripts/create_release.sh
	./scripts/create_release.sh $(VERSION)

