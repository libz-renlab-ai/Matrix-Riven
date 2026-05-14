export {
  tapSession,
  projectDirForCwd,
  claudeTranscriptPath,
  type TapSessionInput,
  type TapSessionDeps,
  type TapSessionResult,
  type TapSessionStatus,
} from './hooks/tap-session.js';

export {
  uploadCcSession,
  uploadEntry,
  classifyResponse,
  type UploadOutcome,
  type UploadInput,
  type UploadDeps,
  type FetchLike,
} from './daemon/uploader.js';

export {
  listPending,
  loadEntry,
  removeEntry,
  moveToDeadLetter,
  enforceCapacity,
  writeMetadataAtomic,
  isEntryTooLarge,
  DEFAULT_QUEUE_CAPACITY_BYTES,
  type QueueEntry,
  type LoadedEntry,
  type LoadedEntryMetadata,
} from './daemon/queue.js';

export {
  backoffMs,
  shouldDeadLetter,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  DEAD_LETTER_AFTER_MS,
} from './daemon/backoff.js';

export {
  acquirePidLock,
  releasePidLock,
  readPidFile,
  isPidAlive,
  runUploadCycle,
  mainLoop,
  POLL_INTERVAL_MS,
  IDLE_EXIT_MS,
  type DaemonConfig,
  type CycleSummary,
  type CyclePerEntryOutcome,
  type PidFileContent,
  type MainLoopExit,
} from './daemon/process-manager.js';

export { runDaemon } from './bin-uploader.js';
export { readLastUploaderError, type UploaderLogError } from './daemon/uploader-log.js';

export {
  listLocalSessions,
  filterToUtcDate,
  planIncrementalUpload,
  type LocalSession,
  type ScanLocalDeps,
} from './incremental/scan.js';

export {
  probeQuota,
  parseQuotaHeaders,
  type ProbeQuotaInput,
  type ProbeQuotaDeps,
  type ProbeQuotaResult,
} from './quota/probe.js';

export {
  claudeCredentialsPath,
  loadOAuthCredentials,
  loadQuotaCache,
  saveQuotaCache,
  markStale,
  type OAuthCredentials,
  type FsReadDeps,
  type FsWriteDeps,
} from './quota/state.js';

export {
  shouldRunHourlyScan,
  loadLastHourlyScanAt,
  recordHourlyScanFired,
  type SchedulerReadDeps,
  type SchedulerWriteDeps,
} from './quota/scheduler.js';

export {
  runHourlyScanIfDue,
  utcDateString,
  projectDirFromTranscriptPath,
  type HourlyScanInput,
  type HourlyScanDeps,
  type HourlyScanOutcome,
} from './quota/hourly.js';

export {
  postCcStatusSnapshot,
  type PostCcStatusOptions,
  type PostCcStatusOutcome,
} from './realtime-client.js';
