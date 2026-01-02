/**
 * Local Callback Server
 *
 * Runs a temporary HTTP server on localhost to receive OAuth callbacks.
 * More reliable than custom URI schemes which browsers may not recognize.
 */

import * as http from "http";
import * as vscode from "vscode";

const HTML_SUCCESS = `
<!DOCTYPE html>
<html>
<head>
  <title>REST Lens - Authentication Complete</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authentication Successful</h1>
    <p>You can close this window and return to VS Code.</p>
  </div>
</body>
</html>
`;

const HTML_ERROR = (error: string) => `
<!DOCTYPE html>
<html>
<head>
  <title>REST Lens - Authentication Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authentication Failed</h1>
    <p>${error}</p>
    <p>Please close this window and try again in VS Code.</p>
  </div>
</body>
</html>
`;

export interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Start a temporary localhost server to receive the OAuth callback.
 * Returns a promise that resolves with the callback parameters.
 */
export function startCallbackServer(expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      // Validate state
      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(HTML_ERROR("Invalid state parameter. Please try again."));
        server.close();
        reject(new Error("Invalid state parameter"));
        return;
      }

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(HTML_ERROR(errorDescription || error));
        server.close();
        resolve({ error, errorDescription: errorDescription || undefined });
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(HTML_ERROR("No authorization code received."));
        server.close();
        reject(new Error("No authorization code received"));
        return;
      }

      // Success!
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML_SUCCESS);
      server.close();
      resolve({ code, state: state || undefined });
    });

    // Find an available port
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        // Store port so OAuth flow can use it
        (server as any)._port = port;
      }
    });

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Authentication timeout"));
    }, 5 * 60 * 1000);

    server.on("close", () => {
      clearTimeout(timeout);
    });

    // Make server accessible
    (startCallbackServer as any)._server = server;
  });
}

/**
 * Get the callback URL for the currently running server.
 */
export function getCallbackUrl(): string | null {
  const server = (startCallbackServer as any)._server;
  if (!server) return null;

  const address = server.address();
  if (address && typeof address === "object") {
    return `http://127.0.0.1:${address.port}/callback`;
  }
  return null;
}

/**
 * Stop the callback server if running.
 */
export function stopCallbackServer(): void {
  const server = (startCallbackServer as any)._server;
  if (server) {
    server.close();
    (startCallbackServer as any)._server = null;
  }
}
