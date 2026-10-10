/**
 * Entry of the MCP server process: the app's own executable in Node mode, started by
 * `Inkling --mcp` (see host.ts). Stdout carries only JSON-RPC, so every log goes to stderr.
 */
const toStderr = (...args: unknown[]): void => console.error(...args)
console.log = toStderr
console.info = toStderr
console.debug = toStderr

const dataDir = process.env['INKLING_MCP_DATA']
if (!dataDir) {
  console.error('Start the MCP server with: Inkling --mcp')
  process.exit(1)
}

import('./server')
  .then(({ runServer }) => runServer(dataDir, process.env['INKLING_MCP_VERSION'] || '0.0.0'))
  .catch((err) => {
    console.error('Inkling MCP server failed to start:', err)
    process.exit(1)
  })
