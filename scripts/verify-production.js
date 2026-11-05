#!/usr/bin/env node
/**
 * Production check for the static site GitHub Pages serves:
 * index.html + report-store.js. There is no separate bundle.
 */
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const unit = spawnSync(process.execPath, ["--test", path.join(root, "test/report-store.test.js")], {
  stdio: "inherit"
});
if (unit.status !== 0) fail("unit tests failed");

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!html.includes('<script src="report-store.js"></script>')) {
  fail("index.html does not load report-store.js");
}
if (/db\.reports\s*=\s*d\.reports/.test(html)) {
  fail("index.html still replaces the report list with the cloud snapshot");
}
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!inline) fail("inline script missing");
const inlinePath = path.join("/tmp", "sr-inline-check.js");
fs.writeFileSync(inlinePath, inline[1]);
[inlinePath, path.join(root, "report-store.js")].forEach(function (file) {
  const syntax = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (syntax.status !== 0) fail("syntax check failed for " + file);
});

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function serve() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end("no");
        return;
      }
      fs.readFile(file, function (err, buf) {
        if (err) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

function chromeBin() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  fail("Chrome is not installed; cannot verify the production page");
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function cdp(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise(function (resolve, reject) {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });
  function call(method, params) {
    const thisId = ++id;
    return new Promise(function (resolve, reject) {
      pending.set(thisId, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: thisId, method: method, params: params || {} }));
    });
  }
  await call("Runtime.enable");
  const result = await call("Runtime.evaluate", {
    expression: expression,
    awaitPromise: true,
    returnByValue: true
  });
  ws.close();
  return result;
}

async function main() {
  const server = await serve();
  const port = server.address().port;
  const url = "http://127.0.0.1:" + port + "/test/browser-harness.html";
  const bin = chromeBin();
  const debugPort = 9333;
  const chrome = spawn(bin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=/tmp/sr-chrome-profile-" + process.pid,
    url
  ], { stdio: "ignore" });

  let text = "";
  try {
    let wsUrl = "";
    for (let i = 0; i < 40 && !wsUrl; i++) {
      await sleep(250);
      try {
        const list = await fetch("http://127.0.0.1:" + debugPort + "/json/list").then(function (r) { return r.json(); });
        const page = list.find(function (t) { return t.type === "page" && t.webSocketDebuggerUrl && /browser-harness/.test(t.url || ""); })
          || list.find(function (t) { return t.type === "page" && t.webSocketDebuggerUrl; });
        if (page) wsUrl = page.webSocketDebuggerUrl;
      } catch (e) {}
    }
    if (!wsUrl) fail("Chrome did not expose a DevTools target");

    for (let i = 0; i < 40; i++) {
      const evaluated = await cdp(wsUrl, "document.getElementById('out') ? document.getElementById('out').textContent : ''");
      text = evaluated && evaluated.result ? evaluated.result.value : "";
      if (text && text !== "RUNNING") break;
      await sleep(250);
    }
  } finally {
    chrome.kill("SIGKILL");
    server.close();
  }

  console.log("browser:", text);
  if (text !== "SELFTEST_OK") fail("production page self-test failed: " + text);
  console.log("production build ok (static index.html + report-store.js)");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
