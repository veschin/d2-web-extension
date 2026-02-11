.PHONY: firefox chrome dev clean

firefox:
	npm run build:firefox && npm run lint:firefox && npm run package:firefox

chrome:
	PRODUCTION=1 BUILD_TARGET=chrome node esbuild.config.mjs && cd dist-chrome && zip -r ../d2ext-chrome.zip .

dev:
	npm run dev:firefox

clean:
	npm run clean
