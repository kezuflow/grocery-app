const { getDefaultConfig } = require("expo/metro-config");
const captureBundle = require("./scripts/capture-bundle.cjs");

const config = getDefaultConfig(__dirname);
if (process.env.FM_NATIVE_EVIDENCE) {
  const original = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) =>
    captureBundle(original ? original(middleware, server) : middleware, {
      destination: process.env.FM_NATIVE_EVIDENCE,
      sourceSha: process.env.FM_NATIVE_SOURCE_SHA,
    });
}
module.exports = config;
