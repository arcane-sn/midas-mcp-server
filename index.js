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

const app = createMcpExpressApp({ allowedHosts: ['midas.arcane-magus.site', 'localhost', '127.0.0.1'] });

app.use((req, res, next) => {
  const header = req.headers.authorization;
  if (header !== `Bearer ${BEARER_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

app.post('/mcp', async (req, res) => {
  const server = getServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/pending-actions', (req, res) => {
  res.json({ actions: fetchAndClearPendingActions() });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`midas-mcp-server listening on 127.0.0.1:${PORT}`);
});
