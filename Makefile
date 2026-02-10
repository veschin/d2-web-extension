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
	xdg-open 'chrome://extensions/' 2>/dev/null || open 'chrome://extensions/' 2>/dev/null || echo 'chrome://extensions/'

debug-firefox:
	xdg-open 'about:debugging#/runtime/this-firefox' 2>/dev/null || open 'about:debugging#/runtime/this-firefox' 2>/dev/null || echo 'about:debugging#/runtime/this-firefox'
