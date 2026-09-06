import type { ContentPart, Message } from '@superliora/kosong';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeFamilyBudgetOverflowToolCallIds,
  MicroCompaction,
  MicroTriggerTracker,
  MICRO_TOOL_RESULT_FAMILY_KEEP,
  MICRO_TOOL_RESULT_FAMILY_KEEP_LOW_PRESSURE,
  resolveMicroToolResultFamilyKeep,
} from '../../../src/agent/compaction/micro';

import type { AgentRecord } from '../../../src/agent';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  InMemoryAgentRecordPersistence,
} from '../../../src/agent/records';
import { FLAG_DEFINITIONS, FlagResolver, MASTER_ENV } from '../../../src/flags';
import { estimateTokensForMessages } from '../../../src/utils/tokens';
import { recordingTelemetry, type TelemetryRecord } from '../../fixtures/telemetry';
import { testAgent, type TestAgentContext } from '../harness/agent';

const CATALOGUED_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'kimi-code',
} as const;
const CATALOGUED_MODEL_CAPABILITIES = {
  image_in: true,
  video_in: true,
  audio_in: false,
  pdf_in: false,
  thinking: true,
  tool_use: true,
  max_context_tokens: 256_000,
} as const;
