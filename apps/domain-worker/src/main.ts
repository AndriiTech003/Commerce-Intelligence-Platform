import { onShutdown, startTelemetry } from '@cip/observability';
import { loadConfig } from './config';

const config = loadConfig();
const telemetry = startTelemetry({
  serviceName: 'domain-worker',
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const { startDomainWorker } = await import('./worker');
const worker = await startDomainWorker(config);
onShutdown(worker.logger, async () => {
  await worker.stop();
  await telemetry.shutdown();
});
