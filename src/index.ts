import { App } from './app.js';

const app = new App();

process.on('SIGINT', () => void app.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void app.stop().then(() => process.exit(0)));

await app.start();
