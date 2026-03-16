import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { FeatmapClient } from "./client.js";
import { registerDevTools } from "./tools/dev.js";
import { registerPlanningTools } from "./tools/planning.js";

const PORT = parseInt(process.env.MCP_PORT ?? "3000", 10);

// Session registry: sessionId → transport
const transports = new Map<string, StreamableHTTPServerTransport>();

function createServer(): McpServer {
  const client = new FeatmapClient();
  const server = new McpServer({
    name: "featmap",
    version: "1.0.0",
  });

  registerDevTools(server, client);
  registerPlanningTools(server, client);

  return server;
}

const app = express();
app.use(express.json());

// POST /mcp — create new session or route message to existing session
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad request: missing or invalid session" },
    id: null,
  });
});

// GET /mcp — SSE streaming for existing session
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  res.status(400).send("Invalid or missing session ID");
});

// DELETE /mcp — explicit session cleanup
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
    return;
  }

  res.status(404).send("Session not found");
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", sessions: transports.size });
});

app.listen(PORT, () => {
  console.log(`Featmap MCP server listening on port ${PORT}`);
  console.log(`Connect via: http://<host>:${PORT}/mcp`);
});
