import {
  createRPC,
  ErrorCodes,
  LioraError,
  parseConfigString,
  resolveConfigPath,
  type RPCMethods,
} from '@superliora/agent-core';
import { z } from 'zod';

export type LioraConfigValidationPathSegment = string | number;

export interface LioraConfigValidationIssue {
  readonly path: readonly LioraConfigValidationPathSegment[];
  readonly message: string;
}

export interface ResolveLioraConfigPathInput {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}

export interface ValidateLioraConfigTomlInput {
  readonly text: string;
  readonly filePath?: string | undefined;
}

export interface LioraConfigRpc {
  resolveConfigPath(input?: ResolveLioraConfigPathInput): Promise<string>;
  validateConfigToml(input: ValidateLioraConfigTomlInput): Promise<void>;
}

interface LioraConfigCoreRpc {
  resolveConfigPath(input: ResolveLioraConfigPathInput): string;
  validateConfigToml(input: ValidateLioraConfigTomlInput): void;
}

interface LioraConfigClientRpc {}

class LioraConfigCoreRpcImpl implements LioraConfigCoreRpc {
  resolveConfigPath(input: ResolveLioraConfigPathInput): string {
    return resolveConfigPath(input);
  }

  validateConfigToml(input: ValidateLioraConfigTomlInput): void {
    try {
      parseConfigString(input.text, input.filePath);
    } catch (error) {
      const validationIssues = extractValidationIssues(error);
      if (validationIssues !== undefined) {
        throw toConfigValidationError(error, validationIssues);
      }
      throw error;
    }
  }
}

export class LioraConfigRpcClient implements LioraConfigRpc {
  private readonly ready: Promise<RPCMethods<LioraConfigCoreRpc>>;

  constructor() {
    const [coreRpc, clientRpc] = createRPC<LioraConfigCoreRpc, LioraConfigClientRpc>();
    void coreRpc(new LioraConfigCoreRpcImpl());
    this.ready = clientRpc({});
  }

  async resolveConfigPath(input: ResolveLioraConfigPathInput = {}): Promise<string> {
    const rpc = await this.ready;
    return rpc.resolveConfigPath(input);
  }

  async validateConfigToml(input: ValidateLioraConfigTomlInput): Promise<void> {
    const rpc = await this.ready;
    await rpc.validateConfigToml(input);
  }
}

export function createLioraConfigRpc(): LioraConfigRpc {
  return new LioraConfigRpcClient();
}

function toConfigValidationError(
  error: unknown,
  validationIssues: readonly LioraConfigValidationIssue[],
): LioraError {
  const details =
    error instanceof LioraError && error.details !== undefined
      ? { ...error.details, validationIssues }
      : { validationIssues };

  if (error instanceof LioraError) {
    return new LioraError(error.code, error.message, { details });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new LioraError(ErrorCodes.CONFIG_INVALID, message, { details });
}

function extractValidationIssues(error: unknown): readonly LioraConfigValidationIssue[] | undefined {
  const zodError = findZodError(error);
  if (zodError === undefined) return undefined;
  return zodError.issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    ),
    message: issue.message,
  }));
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause instanceof z.ZodError) return error.cause;
  return undefined;
}
