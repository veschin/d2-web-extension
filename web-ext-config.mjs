export default {
  run: {
    startUrl: ['about:debugging#/runtime/this-firefox'],
    browserConsole: true,
    reload: true,
  },
  build: {
    overwriteDest: true,
  },
  lint: {
    selfHosted: false,
  },
};
