import { onShutdown, startTelemetry } from '@cip/observability';
import { loadConfig } from './config';

const config = loadConfig();
const telemetry = startTelemetry({
  serviceName: 'realtime-gateway',
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const { startGateway } = await import('./gateway');
const gateway = await startGateway(config);
onShutdown(gateway.logger, async () => {
  await gateway.stop();
  await telemetry.shutdown();
});
