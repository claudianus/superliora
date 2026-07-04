const CAPTURE_RETRY_POLICIES = Object.freeze({
  autocomplete: Object.freeze({
    maxAttempts: 3,
    retryDelayMs: 650,
    recoveryKeys: Object.freeze(['Tab']),
    reason: 'Slash-command suggestions can appear one render tick after the first Tab in tmux captures.',
  }),
});

export function captureRetryPolicyForScenario(scenario) {
  return CAPTURE_RETRY_POLICIES[scenario];
}
