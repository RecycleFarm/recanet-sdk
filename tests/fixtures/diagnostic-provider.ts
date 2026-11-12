import { LoggerProvider, BatchLogRecordProcessor, InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { configureDiagnostics } from '../../dist/index.js';
const loggerProvider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({ exporter: new InMemoryLogRecordExporter(), maxQueueSize: 32, maxExportBatchSize: 8 })] });
configureDiagnostics({ loggerProvider });
await loggerProvider.shutdown();
