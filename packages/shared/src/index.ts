export {
  digitalTwinPaths,
  DEFAULT_PATHS,
  resolveDataRootDir,
  type DigitalTwinPaths,
} from './paths.js';

export { readEnvWithLegacy } from './compat.js';

export { MAX_PAYLOAD_BYTES } from './limits.js';

export { getUserId, getMachineId } from './identity.js';

export {
  loadConfig,
  saveConfig,
  defaultConfig,
  isEnabled,
  ensureDefaultConfig,
  TEAM_SHARED_TOKEN,
  quotaProbeSettings,
  DEFAULT_QUOTA_PROBE_WINDOW_MINUTES,
  FIRST_RUN_BANNER,
  type DigitalTwinConfig,
  type DefaultConfigInput,
  type EnsureDefaultConfigDeps,
  type QuotaProbeConfig,
  type ResolvedQuotaProbeSettings,
} from './config.js';

export {
  buildCcSessionEnvelope,
  isCcSessionMetadata,
  type CcSessionEnvelope,
  type CcSessionEnvelopeBlock,
  type CcSessionMetadata,
  type CcSessionQuotaBlock,
  type BuildEnvelopeInput,
  type EnvelopeExtras,
  type HostInfo,
  type SettingsDigest,
  type RedactionLocationCounts,
} from './schemas/cc-session.js';

export {
  buildRecordingEnvelope,
  isRecordingMetadata,
  RECORDING_CODEC_DEFAULTS,
  type RecordingEnvelope,
  type RecordingMetadata,
  type BuildRecordingEnvelopeInput,
} from './schemas/recording.js';

export {
  CC_STATUS_SCHEMA_VERSION,
  CC_STATUS_FILE_SUFFIX,
  CONTEXT_BUDGET_TOKENS,
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  shouldPush,
  parseTranscriptLines,
  buildCcStatusSnapshot,
  safeStatusUserId,
  sanitizeCcStatusSnapshot,
  ccStatusJsonlPath,
  appendCcStatusSnapshot,
  readLatestPerSession,
  readLatestForSession,
  readLatestAllUsers,
  readHistory,
  type CcSessionHealth,
  type CcStatusSnapshot,
  type CcStatusQueryRow,
  type UserDecision,
  type CompactTrigger,
  type TranscriptMetrics,
  type QuotaSnapshotInput,
  type BuildCcStatusInput,
  type AppendResult,
} from './cc-status/index.js';

export {
  safeUserId,
  dateStamp,
  isUnreservedComponent,
} from './cc-status/path-safety.js';

export {
  detectSensitiveText,
  redactSensitiveText,
  scanTranscriptForStats,
  luhnCheck,
  PII_PATTERNS,
  PII_CC_PATTERN,
  type SensitiveFinding,
  type SensitiveFindingKind,
  type TranscriptRedactionStats,
} from './pii/redactor.js';
