import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { BENCH_SCHEMA_VERSION, SUPPORTED_SUITES, SUPPORTED_TASK_EXPECTED_OUTCOMES } from './constants.mjs';

export async function loadTasks(taskDir, suite) {
  const files = listJsonFiles(taskDir);
  const allTasks = [];
  const errors = [];
  for (const file of files) {
    try {
      const task = JSON.parse(await readFile(file, 'utf8'));
      const validation = validateTask(task, file);
      if (validation.length > 0) {
        errors.push(...validation);
        continue;
      }
      allTasks.push({ ...task, sourcePath: file });
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Task bank validation failed: ${errors.join('; ')}`);
  }
  const tasks = allTasks
    .filter((task) => suite === 'all' || task.suite === suite)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  if (tasks.length === 0) {
    throw new Error(`No benchmark tasks found for suite "${suite}" in ${taskDir}`);
  }
  const allTaskSummaries = allTasks.map(taskSummary);
  return {
    schemaVersion: BENCH_SCHEMA_VERSION,
    taskDir,
    suite,
    discovered: allTasks.length,
    selected: tasks.length,
    allTaskSummaries,
    taskSummaries: tasks.map(taskSummary),
    tasks,
  };
}

function taskSummary(task) {
  return {
    id: task.id,
    suite: task.suite,
    title: task.title,
    sourcePath: task.sourcePath,
    tags: task.tags ?? [],
    risk: task.risk ?? 'low',
  };
}

function listJsonFiles(taskDir) {
  const entries = readdirSync(taskDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(taskDir, entry.name))
    .toSorted();
}

function validateTask(task, file) {
  const errors = [];
  if (task.schemaVersion !== BENCH_SCHEMA_VERSION) errors.push(`${file}: schemaVersion must be ${BENCH_SCHEMA_VERSION}`);
  for (const key of ['id', 'title', 'suite', 'prompt']) {
    if (typeof task[key] !== 'string' || task[key].trim() === '') errors.push(`${file}: ${key} is required`);
  }
  if (!SUPPORTED_SUITES.has(task.suite) || task.suite === 'all') {
    errors.push(`${file}: suite must be seed, holdout, guard, or system`);
  }
  if (task.expectedOutcome !== undefined && !SUPPORTED_TASK_EXPECTED_OUTCOMES.has(task.expectedOutcome)) {
    errors.push(`${file}: expectedOutcome must be one of: ${[...SUPPORTED_TASK_EXPECTED_OUTCOMES].join(', ')}`);
  }
  if (!Array.isArray(task.checks) || task.checks.length === 0) errors.push(`${file}: checks must be a non-empty array`);
  if (task.setup !== undefined && !Array.isArray(task.setup.files ?? [])) errors.push(`${file}: setup.files must be an array`);
  if (task.fixtureActions !== undefined && !Array.isArray(task.fixtureActions)) errors.push(`${file}: fixtureActions must be an array`);
  if (task.contamination !== undefined && !Array.isArray(task.contamination.blockedFiles ?? [])) {
    errors.push(`${file}: contamination.blockedFiles must be an array`);
  }
  if (task.budgets !== undefined) {
    if (task.budgets === null || typeof task.budgets !== 'object' || Array.isArray(task.budgets)) {
      errors.push(`${file}: budgets must be an object`);
    } else {
      for (const key of ['maxWallMs', 'maxCommands', 'maxPromptChars']) {
        if (task.budgets[key] !== undefined && (!Number.isFinite(task.budgets[key]) || task.budgets[key] < 0)) {
          errors.push(`${file}: budgets.${key} must be a non-negative number`);
        }
      }
    }
  }
  for (const check of task.checks ?? []) {
    switch (check.type) {
      case 'file_exists':
        if (typeof check.path !== 'string') errors.push(`${file}: file_exists checks require path`);
        break;
      case 'file_contains':
        if (typeof check.path !== 'string') errors.push(`${file}: file_contains checks require path`);
        if (typeof check.text !== 'string' || check.text.length === 0) {
          errors.push(`${file}: file_contains checks require non-empty text`);
        }
        break;
      case 'json_field':
        if (typeof check.path !== 'string') errors.push(`${file}: json_field checks require path`);
        if (typeof check.pointer !== 'string') errors.push(`${file}: json_field checks require pointer`);
        break;
      case 'command':
      case 'source_command':
        if (typeof check.command !== 'string' || check.command.trim() === '') {
          errors.push(`${file}: ${check.type} checks require command`);
        }
        if (check.args !== undefined && !Array.isArray(check.args)) {
          errors.push(`${file}: ${check.type} check args must be an array`);
        }
        break;
      default:
        errors.push(`${file}: unsupported check type ${String(check.type)}`);
    }
  }
  return errors;
}
