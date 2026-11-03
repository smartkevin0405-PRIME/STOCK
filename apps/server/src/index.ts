import { buildApp } from './app';
import { MockProvider } from './market/mock';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const provider = new MockProvider();
await provider.start();

const app = await buildApp({ provider, logger: true });
await app.listen({ port, host });

const shutdown = async () => {
  provider.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
