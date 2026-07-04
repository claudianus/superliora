import {
  commandRecord,
  exists,
  readFileIfExists,
  readJsonPointer,
  resolveInside,
  round,
  runBoundedCommand,
} from './utils.mjs';

export async function runChecks({ checks, sourceCheckout, workspace }) {
  const results = [];
  for (const check of checks) {
    results.push(await runCheck({ check, sourceCheckout, workspace }));
  }
  return results;
}

export function scoreChecks(checks) {
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  if (total <= 0) return 0;
  const passed = checks
    .filter((check) => check.status === 'PASS')
    .reduce((sum, check) => sum + check.weight, 0);
  return round(passed / total);
}

async function runCheck({ check, sourceCheckout, workspace }) {
  try {
    if (check.type === 'file_exists') {
      const target = resolveInside(workspace, check.path);
      const present = await exists(target);
      return checkResult(check, present, present ? 'File exists.' : 'File is missing.');
    }
    if (check.type === 'file_contains') {
      if (typeof check.text !== 'string' || check.text.length === 0) {
        return checkResult(check, false, 'file_contains check requires non-empty text.');
      }
      const target = resolveInside(workspace, check.path);
      const content = (await readFileIfExists(target)) ?? '';
      const passed = content.includes(check.text);
      return checkResult(check, passed, passed ? 'Expected text is present.' : 'Expected text is missing.');
    }
    if (check.type === 'json_field') {
      const target = resolveInside(workspace, check.path);
      const parsed = JSON.parse((await readFileIfExists(target)) ?? 'null');
      const actual = readJsonPointer(parsed, check.pointer);
      const passed = JSON.stringify(actual) === JSON.stringify(check.equals);
      return checkResult(check, passed, passed ? 'JSON field matched.' : `JSON field mismatch: ${JSON.stringify(actual)}`);
    }
    if (check.type === 'command') {
      const result = runBoundedCommand(check.command, check.args ?? [], {
        cwd: workspace,
        timeoutMs: check.timeoutMs ?? 30_000,
      });
      const passed = result.status === (check.exitCode ?? 0) && !result.timedOut;
      return {
        ...checkResult(check, passed, passed ? 'Command assertion passed.' : `Command exited ${result.status}.`),
        command: commandRecord('check-command', 'check', result, {}),
      };
    }
    if (check.type === 'source_command') {
      const cwd = check.cwd === undefined ? sourceCheckout : resolveInside(sourceCheckout, check.cwd);
      const env = {
        ...process.env,
        KIMI_BENCH_SOURCE_CHECKOUT: sourceCheckout,
        KIMI_BENCH_WORKSPACE: workspace,
      };
      const result = runBoundedCommand(check.command, check.args ?? [], {
        cwd,
        env,
        timeoutMs: check.timeoutMs ?? 30_000,
      });
      const passed = result.status === (check.exitCode ?? 0) && !result.timedOut;
      return {
        ...checkResult(check, passed, passed ? 'Source command assertion passed.' : `Source command exited ${result.status}.`),
        command: commandRecord('source-command', 'check', result, { cwdKind: 'sourceCheckout' }),
      };
    }
    return checkResult(check, false, `Unsupported check type: ${check.type}`);
  } catch (error) {
    return checkResult(check, false, error.message);
  }
}

function checkResult(check, passed, reason) {
  return {
    type: check.type,
    path: check.path,
    status: passed ? 'PASS' : 'FAIL',
    reason,
    weight: check.weight ?? 1,
  };
}
