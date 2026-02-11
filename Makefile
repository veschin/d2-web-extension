.PHONY: firefox chrome dev clean sources

firefox:
	npm run build:firefox && npm run lint:firefox && npm run package:firefox

chrome:
	PRODUCTION=1 BUILD_TARGET=chrome node esbuild.config.mjs && cd dist-chrome && zip -r ../d2ext-chrome.zip .

sources:
	zip -r d2ext-sources.zip src/ assets/ package.json package-lock.json esbuild.config.mjs tsconfig.json Makefile web-ext-config.mjs PRIVACY_POLICY.md LICENSE BUILD_INSTRUCTIONS.md -x "src/**/*.test.ts" "src/test-setup.ts"

dev:
	npm run dev:firefox

clean:
	npm run clean
