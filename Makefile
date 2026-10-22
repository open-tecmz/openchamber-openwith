# Developer tasks for the openchamber-openwith extension.
#
# Targets are listed alphabetically. Run `make help` (or open the Makefile
# panel) to see every target.

.PHONY: build clean help package test typecheck

build: ## Build the installable package into dist/
	npm run build

clean: ## Remove build output and local test artefacts
	rm -rf dist _temp/data openchamber-openwith.zip

help: ## List the available targets
	@awk -F'## ' '/^[a-zA-Z0-9_-]+:/ {t=$$1; sub(/:.*/,"",t); printf "  %-12s %s\n", t, $$2}' Makefile

package: build ## Build, then zip dist/ into openchamber-openwith.zip
	cd dist && zip -qr ../openchamber-openwith.zip .

test: ## Build, then run the service, i18n and web-link tests
	npm run test

typecheck: ## Type-check the sources
	npm run typecheck
