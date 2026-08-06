/**
 * Goal and Ultrawork RPC delegation for `SDKRpcClientBase` — extracted from rpc.ts.
 */

import type {
  CancelUltraworkInput,
  CreateGoalInput,
  CreateUltraworkRunInput,
  GoalSnapshot,
  GoalToolResult,
  PauseUltraworkInput,
  ResumeUltraworkPayloadResult,
  SwarmRestaffInput,
  UltraworkAutoActivationDecision,
  UltraworkObjectiveProfileDecision,
  UltraworkRun,
} from '#/session/types';

import type { SessionIdRpcInput } from './rpc-types';
import { SDKRpcClientMemoryMixin } from './rpc-memory-mixin';

export abstract class SDKRpcClientGoalsUltraworkMixin extends SDKRpcClientMemoryMixin {
  async createGoal(input: SessionIdRpcInput & CreateGoalInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.createGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      objective: input.objective,
      replace: input.replace,
      source: input.source,
      gateCommand: input.gateCommand,
    });
  }

  async getGoal(input: SessionIdRpcInput): Promise<GoalToolResult> {
    const rpc = await this.getRpc();
    return rpc.getGoal({ sessionId: input.sessionId, agentId: this.interactiveAgentId });
  }

  async pauseGoal(input: SessionIdRpcInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.pauseGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async resumeGoal(input: SessionIdRpcInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.resumeGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async cancelGoal(input: SessionIdRpcInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.cancelGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async createUltraworkRun(
    input: SessionIdRpcInput & CreateUltraworkRunInput,
  ): Promise<UltraworkRun> {
    const rpc = await this.getRpc();
    return rpc.createUltraworkRun({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      id: input.id,
      objective: input.objective,
      source: input.source,
      replaceGoal: input.replaceGoal,
      evidenceRoot: input.evidenceRoot,
      workDir: input.workDir,
    });
  }

  async getUltraworkRun(input: SessionIdRpcInput): Promise<UltraworkRun | null> {
    const rpc = await this.getRpc();
    return rpc.getUltraworkRun({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async pauseUltrawork(
    input: SessionIdRpcInput & PauseUltraworkInput,
  ): Promise<UltraworkRun | null> {
    const rpc = await this.getRpc();
    return rpc.pauseUltrawork({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      reason: input.reason,
    });
  }

  async swarmRestaff(input: SessionIdRpcInput & SwarmRestaffInput): Promise<boolean> {
    const rpc = await this.getRpc();
    return rpc.swarmRestaff({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      reason: input.reason,
    });
  }

  async classifyUltraworkAutoActivation(
    input: SessionIdRpcInput & { readonly text: string },
  ): Promise<UltraworkAutoActivationDecision> {
    const rpc = await this.getRpc();
    return rpc.classifyUltraworkAutoActivation({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      text: input.text,
    });
  }

  async classifyUltraworkObjectiveProfile(
    input: SessionIdRpcInput & { readonly text: string },
  ): Promise<UltraworkObjectiveProfileDecision> {
    const rpc = await this.getRpc();
    return rpc.classifyUltraworkObjectiveProfile({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      text: input.text,
    });
  }

  async resumeUltrawork(input: SessionIdRpcInput): Promise<ResumeUltraworkPayloadResult | null> {
    const rpc = await this.getRpc();
    return rpc.resumeUltrawork({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async cancelUltrawork(
    input: SessionIdRpcInput & CancelUltraworkInput,
  ): Promise<UltraworkRun | null> {
    const rpc = await this.getRpc();
    return rpc.cancelUltrawork({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      reason: input.reason,
    });
  }
}
