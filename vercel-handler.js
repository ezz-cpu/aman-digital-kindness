import { createApp } from './server.js';

async function createHostedApplication() {
  if (!process.env.DATABASE_URL) throw new Error('Vercel requires an external PostgreSQL database.');
  // Vercel replaces X-Forwarded-For with the connecting client's IP. The public
  // function is reached through that proxy, never through an exposed Node port.
  return createApp({ secureCookies: true, trustProxyHops: 1 });
}

export function createFunctionHandler(createApplication = createHostedApplication) {
  let application;
  return async (req, res) => {
    try {
      application ||= Promise.resolve().then(createApplication).catch(error => {
        application = undefined;
        throw error;
      });
      const server = await application;
      await server.listeners('request')[0](req, res);
    } catch {
      console.error('Aman could not serve a hosted request.');
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'server_unavailable' }));
      } else if (!res.writableEnded) res.end();
    }
  };
}
