import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { insertPendingAction, fetchAndClearPendingActions } from './db.js';

const PORT = 3000;
const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

if (!BEARER_TOKEN) {
  throw new Error('MCP_BEARER_TOKEN environment variable is required');
}

function getServer() {
  const server = new McpServer({ name: 'midas', version: '1.0.0' });
  server.registerTool(
    'create_budget',
    {
      description: "Queue a new monthly budget to be added to the user's Midas app on next sync.",
      inputSchema: {
        categoryName: z.string().describe('Category name, e.g. "Groceries" or "Transport"'),
        subcategoryName: z.string().optional().describe('Optional sub-category name'),
        limitAmount: z.number().int().positive().describe('Monthly limit in whole Indonesian Rupiah'),
      },
    },
    async ({ categoryName, subcategoryName, limitAmount }) => {
      insertPendingAction({
        type: 'create_budget',
        payload: JSON.stringify({ categoryName, subcategoryName: subcategoryName ?? null, limitAmount }),
      });
      const label = subcategoryName ? `${categoryName} / ${subcategoryName}` : categoryName;
      return {
        content: [{ type: 'text', text: `Queued a Rp ${limitAmount.toLocaleString('id-ID')} monthly budget for ${label}. It'll show up in Midas next time you tap "Sync from Claude".` }],
      };
    }
  );
  return server;
}

const mcpApp = createMcpExpressApp({ allowedHosts: ['midas.arcane-magus.site', 'localhost', '127.0.0.1'] });

const app = express();
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[req] ${req.method} ${req.originalUrl} host=${req.headers.host} ua=${req.headers['user-agent']} cf-connecting-ip=${req.headers['cf-connecting-ip']} accept=${req.headers.accept}`);
  res.on('finish', () => {
    console.log(`[res] ${req.method} ${req.originalUrl} status=${res.statusCode} ms=${Date.now() - start}`);
  });
  next();
});
app.use(mcpApp);

mcpApp.use((req, res, next) => {
  const header = req.headers.authorization;
  const expected = `Bearer ${BEARER_TOKEN}`;
  if (header !== expected) {
    const preview = header ? `len=${header.length} starts="${header.slice(0, 12)}" ends="${header.slice(-6)}"` : 'MISSING';
    console.log(`[auth-mismatch] got: ${preview} | expected len=${expected.length} starts="${expected.slice(0, 12)}" ends="${expected.slice(-6)}"`);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

mcpApp.post('/mcp', async (req, res) => {
  const server = getServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

mcpApp.get('/pending-actions', (req, res) => {
  res.json({ actions: fetchAndClearPendingActions() });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`midas-mcp-server listening on 127.0.0.1:${PORT}`);
});
