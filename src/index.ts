import { App } from './app.js';

const app = new App();

function shutdown(signal: string): void {
  // eslint-disable-next-line no-console
  console.error(`[mcp-code1] received ${signal}, shutting down...`);
  app
    .stop()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[mcp-code1] error during shutdown:', err);
      process.exit(1);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Surface unhandled rejections instead of silent crashes
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[mcp-code1] Unhandled rejection:', reason);
});

await app.start();
