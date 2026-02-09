.PHONY: build firefox chrome clean dev lint package

build: firefox

firefox:
	npm run build:firefox

chrome:
	npm run build:chrome

dev:
	npm run dev:firefox

lint:
	npm run build:firefox && npm run lint:firefox

package:
	npm run package:firefox

clean:
	npm run clean
