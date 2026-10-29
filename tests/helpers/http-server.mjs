import { randomInt } from 'node:crypto';

// This machine's OS ephemeral range includes ports blocked by browsers/fetch.
// Bind an unused high port without changing the machine's network settings.
export async function listenForTests(server) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen(randomInt(49152, 65536), '127.0.0.1');
      });
      return;
    } catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; }
  }
  throw new Error('Could not find an unused browser-safe test port.');
}
