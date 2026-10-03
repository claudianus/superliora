import { constants } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import type { TerminalHandle, WaitForTerminalExitResponse } from '@agentclientprotocol/sdk';
import { KaosError, type KaosProcess } from '@superliora/kaos';

/** ACP terminals expose combined output and exit status, but no OS process id. */
export class AcpTerminalProcess implements KaosProcess {
  readonly pid = undefined;
  readonly terminalId: string;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new KaosError('ACP terminals do not support writing process stdin.'));
    },
  });
  exitCode: number | null = null;
  outputTruncated: boolean | undefined;
  private completion: Promise<number>;
  private exited: Promise<WaitForTerminalExitResponse>;
  private exitObservationFailed = false;
  private disposal: Promise<void> | undefined;
  private resourcesSettledInternal: boolean | undefined;

  get resourcesSettled(): boolean | undefined {
    return this.resourcesSettledInternal;
  }

  constructor(private readonly terminal: TerminalHandle) {
    this.terminalId = terminal.id;
    this.exited = terminal.waitForExit().catch((error: unknown) => {
      this.exitObservationFailed = true;
      this.resourcesSettledInternal = false;
      throw error;
    });
    this.completion = this.captureCompletion(true);
    // Execution can fail before the native background manager subscribes.
    void this.completion.catch(() => {});
  }

  private async captureCompletion(collectOutput: boolean): Promise<number> {
    try {
      const status = await this.exited;
      if (collectOutput) {
        const captured = await this.terminal.currentOutput();
        this.outputTruncated = captured.truncated;
        if (captured.truncated) {
          this.stderr.write('[Editor truncated terminal output; only retained output is available.]\n');
        }
        if (captured.output.length > 0) this.stdout.write(captured.output);
      }
      const signalNumber = status.signal === undefined || status.signal === null
        ? undefined : constants.signals[status.signal as keyof typeof constants.signals];
      const code = status.exitCode ?? (signalNumber === undefined ? undefined : 128 + signalNumber);
      if (code === undefined) throw new KaosError('ACP terminal exited without an exit code or known signal.');
      this.exitCode = code;
      return code;
    } finally {
      if (collectOutput) {
        this.stdout.end();
        this.stderr.end();
      }
    }
  }

  wait(): Promise<number> {
    return this.completion;
  }

  /** A kill acknowledgement is not terminal exit; wait remains authoritative. */
  async kill(): Promise<void> {
    await this.terminal.kill();
    if (this.exitObservationFailed) {
      // An explicit operator stop may re-observe this SAME terminal after a
      // failed exit RPC. It never creates or replays a command.
      this.exitObservationFailed = false;
      this.exited = this.terminal.waitForExit().catch((error: unknown) => {
        this.exitObservationFailed = true;
        this.resourcesSettledInternal = false;
        throw error;
      });
      this.completion = this.captureCompletion(false);
      void this.completion.catch(() => {});
      this.disposal = undefined;
    }
  }

  dispose(): Promise<void> {
    this.disposal ??= this.releaseAfterExit();
    return this.disposal;
  }

  private async releaseAfterExit(): Promise<void> {
    this.resourcesSettledInternal = false;
    try {
      await this.exited;
      try {
        await this.completion;
      } finally {
        await this.terminal.release();
        this.resourcesSettledInternal = true;
      }
    } finally {
      this.stdin.destroy();
    }
  }
}
