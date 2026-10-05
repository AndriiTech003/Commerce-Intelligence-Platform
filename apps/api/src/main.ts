import { onShutdown, startTelemetry } from '@cip/observability';
import { loadConfig } from './config';

const config = loadConfig();
const telemetry = startTelemetry({ serviceName: 'api', otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT });
const { createApp } = await import('./app');
const api = await createApp(config);
api.logger.info({ url: api.url }, 'api listening');
onShutdown(api.logger, async () => {
  await api.close();
  await telemetry.shutdown();
});
