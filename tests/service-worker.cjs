const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
(async () => {
  const handlers = {},
    deleted = [];
  const sandbox = {
    URL,
    self: {
      registration: { scope: "https://example.test/Life-log/" },
      addEventListener: (type, fn) => (handlers[type] = fn),
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => [
        "life-log-v1",
        "life-log-v2",
        "life-log-v3",
        "life-log-v4",
        "other-app-v1",
      ],
      delete: async (key) => deleted.push(key),
    },
  };
  vm.runInNewContext(readFileSync("sw.js", "utf8"), sandbox);
  let activation;
  handlers.activate({ waitUntil: (value) => (activation = value) });
  await activation;
  assert.deepEqual(deleted, ["life-log-v1", "life-log-v2", "life-log-v3"]);
  for (const url of [
    "https://example.test/other-app/",
    "https://external.test/",
    "https://example.test/Life-log/api",
  ]) {
    handlers.fetch({
      request: { method: "GET", url },
      respondWith: () => {
        throw Error("unrelated request intercepted");
      },
    });
  }
  console.log(
    "PASS: service worker deletes only its old caches and ignores unrelated URLs",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
