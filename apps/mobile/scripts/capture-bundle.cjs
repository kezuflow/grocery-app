const { createHash } = require("node:crypto");
const { appendFileSync } = require("node:fs");

module.exports = function captureBundle(middleware, { destination, sourceSha }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Invalid evidence source SHA.");
  return (request, response, next) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (!url.pathname.endsWith(".bundle") || request.method !== "GET")
      return middleware(request, response, next);
    const hash = createHash("sha256");
    let bytes = 0;
    const capture = (chunk, encoding) => {
      if (chunk === undefined || chunk === null) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      hash.update(value);
      bytes += value.length;
    };
    const write = response.write;
    const end = response.end;
    response.write = function (chunk, encoding, callback) {
      capture(chunk, typeof encoding === "string" ? encoding : undefined);
      return write.call(this, chunk, encoding, callback);
    };
    response.end = function (chunk, encoding, callback) {
      capture(chunk, typeof encoding === "string" ? encoding : undefined);
      return end.call(this, chunk, encoding, callback);
    };
    response.once("finish", () => {
      appendFileSync(
        destination,
        `${JSON.stringify({
          sourceSha,
          requestUrl: request.url,
          platform: url.searchParams.get("platform"),
          remoteAddress: request.socket.remoteAddress,
          status: response.statusCode,
          contentEncoding: response.getHeader("content-encoding") ?? "identity",
          bytes,
          sha256: hash.digest("hex"),
          finishedAt: new Date().toISOString(),
        })}\n`,
      );
    });
    return middleware(request, response, next);
  };
};
