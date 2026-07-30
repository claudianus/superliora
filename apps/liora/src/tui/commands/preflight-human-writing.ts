import { join } from 'node:path';

import {
  HUMAN_WRITING_CONTRACT_PHRASES,
  HUMAN_WRITING_RUBRIC_PHRASES,
  PREFLIGHT_ULTRAWORK_CONTRACT_PATH,
  preflightSotaCriteriaPath,
  type PreflightHumanWriting,
} from './preflight-types';
import {
  asRecord,
  displayPath,
  missingPhrases,
  readJsonRecord,
  readText,
} from './preflight-utils';

export function loadPreflightHumanWriting(workDir: string): PreflightHumanWriting {
  const contractPath = join(workDir, PREFLIGHT_ULTRAWORK_CONTRACT_PATH);
  const rubricPath = join(workDir, preflightSotaCriteriaPath(workDir));
  const contractText = readText(contractPath);
  const rubric = readJsonRecord(rubricPath);
  const rubricItems = asRecord(rubric?.['loopScoreRubric'])?.['humanWriting'];
  const rubricText = Array.isArray(rubricItems) ? rubricItems.join('\n') : '';
  const missingContract = contractText === undefined
    ? [...HUMAN_WRITING_CONTRACT_PHRASES]
    : missingPhrases(contractText, HUMAN_WRITING_CONTRACT_PHRASES);
  const missingRubric = missingPhrases(rubricText, HUMAN_WRITING_RUBRIC_PHRASES);
  const advisoryOnly = contractText !== undefined
    && /AI-writing detectors[\s\S]*truth/i.test(contractText)
    && /advisory pattern checks/i.test(contractText);
  const contractReady = contractText !== undefined && missingContract.length === 0 && advisoryOnly;
  const rubricReady = rubricText.length > 0 && missingRubric.length === 0;
  const ready = contractReady && rubricReady;
  const blocked = [
    ...(contractReady ? [] : ['contract']),
    ...(rubricReady ? [] : ['rubric']),
    ...(advisoryOnly ? [] : ['advisoryOnly']),
  ];
  return {
    ready,
    contractReady,
    rubricReady,
    advisoryOnly,
    contractPath: displayPath(workDir, contractPath),
    rubricPath: displayPath(workDir, rubricPath),
    nextAction: ready
      ? 'Human-writing anti-slop contract ready; keep detector signals advisory-only.'
      : `Restore human-writing ${blocked.join('/')} guidance, then rerun /preflight.`,
    warning: ready ? undefined : `blocked ${blocked.join(',')}`,
  };
}
