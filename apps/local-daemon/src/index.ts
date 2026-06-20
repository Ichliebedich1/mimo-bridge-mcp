import { createServer } from "node:http";
import { loadDaemonConfig } from "./daemon-config.js";
import { handleAdminApi } from "./admin-api.js";
import { readJsonBody, sendJson, sendText, setCorsHeaders } from "./http-utils.js";
import { createMcpHttpBridge } from "./mcp.js";
import { tryServeStatic } from "./static-files.js";
import { createToolContext } from "./tool-context.js";
import { fail } from "./api-result.js";

const config = loadDaemonConfig();
const context = createToolContext(config);
const mcpBridge = createMcpHttpBridge(context);

const server = createServer(async (req, res) => {
  try {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://" + config.host + ":" + config.port);

    if (url.pathname === "/mcp") {
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        await mcpBridge.handlePost(req, res, body);
        return;
      }
      if (req.method === "GET") {
        await mcpBridge.handleGet(req, res);
        return;
      }
      if (req.method === "DELETE") {
        await mcpBridge.handleDelete(req, res);
        return;
      }
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    if (await handleAdminApi(req, res, url, config, context)) {
      return;
    }

    if (tryServeStatic(req, res, url)) {
      return;
    }

    if (url.pathname === "/") {
      sendText(res, 200, "MiMo Bridge Local Daemon is running. Build apps/admin-ui to serve the UI.");
      return;
    }

    sendJson(res, 404, fail("Not found"));
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, fail(error instanceof Error ? error.message : String(error)));
    } else {
      res.end();
    }
  }
});

server.listen(config.port, config.host, () => {
  process.stderr.write("MiMo Bridge Local Daemon listening on http://" + config.host + ":" + config.port + "\n");
  if (context.degraded) {
    process.stderr.write("Daemon degraded mode: " + context.configError + "\n");
  }
});

process.on("SIGINT", async () => {
  await shutdown();
});

process.on("SIGTERM", async () => {
  await shutdown();
});

async function shutdown(): Promise<void> {
  await mcpBridge.close();
  server.close(() => {
    process.exit(0);
  });
}
