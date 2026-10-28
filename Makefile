# signalk-masterbus Makefile
#
# The npm publishing steps in one place. Publishing to npm is done by hand:
# npm's two-factor login is needed, and the publish job in
# .github/workflows/publish.yml only makes the GitHub release.
#
#   make publish       - Publish the tagged version to npm (VERSION=X.Y.Z,
#                        default: the version in package.json)
#   make publish-dry   - The same, without uploading
#   make check         - Lint, format check, build and tests (npm run check)
#
# Per-developer targets belong in Makefile.local, which is gitignored and
# included at the bottom of this file.

NPM ?= npm
PKG     := $(shell node -p "require('./package.json').name")
VERSION ?= $(shell node -p "require('./package.json').version")
TAG     := v$(VERSION)
# A version with a suffix (0.5.0-beta.1) goes to npm under the `beta` tag,
# so `npm install` and the Signal K app store keep the last release.
DIST_TAG := $(if $(findstring -,$(VERSION)),beta,latest)

.PHONY: publish publish-dry check help

# Publish $(TAG) to npm. IRREVERSIBLE: a published version can be deprecated
# but never replaced. Checks first that the tree is clean, that the tag
# exists, and that this version is not on npm yet; logs in when needed (a
# browser window, for the two-factor check); then checks out the tag,
# publishes it (prepublishOnly fetches the bundled daemons and builds), and
# returns to where you were, also when the publish fails.
publish: preflight
	@$(NPM) whoami >/dev/null 2>&1 || $(NPM) login
	@echo "publishing $(PKG)@$(VERSION) from $(TAG) as $$($(NPM) whoami), tag $(DIST_TAG)"
	@back=$$(git symbolic-ref -q --short HEAD || git rev-parse HEAD); \
	  git checkout -q "$(TAG)" && $(NPM) publish --access public --tag $(DIST_TAG); status=$$?; \
	  git checkout -q "$$back"; exit $$status
	@echo "published; npm can take a few minutes to list it. Waiting..."
	@for i in $$(seq 1 15); do \
	  $(NPM) view "$(PKG)@$(VERSION)" version --fetch-timeout=10000 --fetch-retries=0 \
	    >/dev/null 2>&1 \
	    && { echo "on npm: $(PKG)@$(VERSION)"; exit 0; }; \
	  sleep 10; \
	done; \
	echo "not listed yet; check later with: npm view $(PKG)@$(VERSION) version"

# What publish would upload, from the tag, without uploading.
publish-dry: preflight
	@back=$$(git symbolic-ref -q --short HEAD || git rev-parse HEAD); \
	  git checkout -q "$(TAG)" && $(NPM) publish --access public --tag $(DIST_TAG) --dry-run; status=$$?; \
	  git checkout -q "$$back"; exit $$status

.PHONY: preflight
preflight:
	@git diff --quiet && git diff --cached --quiet \
	  || { echo "working tree not clean: commit or stash first"; exit 1; }
	@git rev-parse -q --verify "refs/tags/$(TAG)" >/dev/null \
	  || { echo "no tag $(TAG): bump, tag and push the release first"; exit 1; }
	@! $(NPM) view "$(PKG)@$(VERSION)" version >/dev/null 2>&1 \
	  || { echo "$(PKG)@$(VERSION) is already on npm"; exit 1; }

check:
	$(NPM) run check

help:
	@echo "signalk-masterbus Makefile targets:"
	@echo ""
	@echo "  make publish        Publish the tagged version to npm (VERSION=X.Y.Z)"
	@echo "  make publish-dry    The same, without uploading"
	@echo "  make check          Lint, format check, build and tests"

-include Makefile.local
