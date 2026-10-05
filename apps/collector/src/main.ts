import { onShutdown, startTelemetry } from '@cip/observability';
import { loadConfig } from './config';

const config = loadConfig();
const telemetry = startTelemetry({
  serviceName: 'collector',
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const { startCollector } = await import('./server');
const collector = await startCollector(config);
collector.logger.info({ url: collector.url }, 'collector listening');
onShutdown(collector.logger, async () => {
  await collector.stop();
  await telemetry.shutdown();
});
