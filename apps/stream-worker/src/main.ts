import { onShutdown, startTelemetry } from '@cip/observability';
import { loadConfig } from './config';

const config = loadConfig();
const telemetry = startTelemetry({
  serviceName: 'stream-worker',
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const { startStreamWorker } = await import('./worker');
const worker = await startStreamWorker(config);
onShutdown(worker.logger, async () => {
  await worker.stop();
  await telemetry.shutdown();
});
