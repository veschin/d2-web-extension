.PHONY: build firefox chrome clean dev lint package debug-chrome debug-firefox

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

debug-chrome:
	open 'chrome://extensions/'

debug-firefox:
	open 'about:debugging#/runtime/this-firefox'
