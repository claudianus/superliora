/**
 * Humanize UltraSwarm collaboration / protocol payloads for TUI live feed.
 * Pure: raw XML/protocol → short headline + body humans can scan.
 */

export type HumanizeSeverity = 'info' | 'success' | 'warning' | 'error' | 'neutral';

export interface HumanizeCollaborationEventInput {
  readonly body?: string;
  readonly channel?: string;
  readonly tag?: string;
  readonly fromName?: string;
  readonly fromExpertId?: string;
  readonly toExpertId?: string;
  readonly phase?: string;
}

export interface HumanizedCollaborationEvent {
  readonly headline: string;
  readonly body: string;
  readonly severity: HumanizeSeverity;
  /** True when the original payload looked like protocol/XML and was rewritten. */
  readonly humanized: boolean;
}

const XML_TAG = /<\/?[a-zA-Z_][\w:.-]*\b[^>]*>/;
const XML_BLOCK = /<\/?(?:team_roster|handoff|expert|debate|debate_draft|debate_draft_pack|phase_handoff_pack|selection_reason|instruction|artifact|prior_turns|integration_report|verdict|dependency_handoff|work_node_contracts|review_revision_request|swarm_channel_rules|collaboration_required|prior_review|upstream)\b/i;

/**
 * Detect protocol-ish messages that should not be shown raw in the feed.
 */
export function looksLikeProtocolMessage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (XML_BLOCK.test(trimmed)) return true;
  if (XML_TAG.test(trimmed) && (trimmed.includes('</') || trimmed.startsWith('<'))) return true;
  if (/^\s*VERDICT\s*:/im.test(trimmed)) return true;
  if (/<\w+[\s>]/.test(trimmed) && /<\/\w+>/.test(trimmed)) return true;
  return false;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripXmlTags(text: string): string {
  return collapseWhitespace(text.replace(/<[^>]+>/g, ' '));
}

function extractXmlAttr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function extractElementText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  if (match?.[1] === undefined) return undefined;
  const text = stripXmlTags(match[1]);
  return text.length === 0 ? undefined : text;
}

function severityForChannel(channel: string | undefined, tag: string | undefined): HumanizeSeverity {
  const key = (channel ?? tag ?? '').toLowerCase();
  if (key === 'block' || key === 'blocker' || key === 'fail' || key === 'stop') return 'warning';
  if (key === 'council' || key === 'done') return 'success';
  if (key === 'mention') return 'info';
  return 'neutral';
}

function humanizeVerdictToken(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('pass') || lower.includes('approve') || lower.includes('승인')) return '통과';
  if (lower.includes('fail') || lower.includes('block') || lower.includes('reject') || lower.includes('차단')) {
    return '차단/실패';
  }
  if (lower.includes('revise') || lower.includes('수정') || lower.includes('보완')) return '수정 필요';
  return raw;
}

/**
 * Convert a collaboration feed event into a human-scannable headline/body.
 * Non-protocol text is returned nearly as-is (headline may summarize channel).
 */
export function humanizeCollaborationEvent(
  event: HumanizeCollaborationEventInput,
): HumanizedCollaborationEvent {
  const rawBody = event.body ?? '';
  const bodyTrimmed = rawBody.trim();
  const from = event.fromName?.trim() || event.fromExpertId?.trim() || 'team';
  const severity = severityForChannel(event.channel, event.tag);

  if (bodyTrimmed.length === 0) {
    return {
      headline: from,
      body: '',
      severity,
      humanized: false,
    };
  }

  if (!looksLikeProtocolMessage(bodyTrimmed)) {
    return {
      headline: from,
      body: collapseWhitespace(bodyTrimmed),
      severity,
      humanized: false,
    };
  }

  // Handoff blocks
  const handoffMatch = /<handoff\b([^>]*)>([\s\S]*?)<\/handoff>/i.exec(bodyTrimmed);
  if (handoffMatch !== null) {
    const attrs = handoffMatch[1] ?? '';
    const inner = stripXmlTags(handoffMatch[2] ?? '');
    const expertId = extractXmlAttr(attrs, 'expert_id') ?? from;
    const phase = extractXmlAttr(attrs, 'phase') ?? event.phase;
    const verdict = humanizeVerdictToken(extractXmlAttr(attrs, 'verdict'));
    const headlineParts = [expertId, phase, verdict].filter((part): part is string => part !== undefined && part.length > 0);
    return {
      headline: headlineParts.join(' · ') || 'handoff',
      body: inner.length > 0 ? inner : '전문가 핸드오프를 전달했습니다.',
      severity: verdict === '차단/실패' ? 'error' : verdict === '통과' ? 'success' : 'info',
      humanized: true,
    };
  }

  // Expert result blocks
  const expertMatch = /<expert\b([^>]*)>([\s\S]*?)<\/expert>/i.exec(bodyTrimmed);
  if (expertMatch !== null) {
    const attrs = expertMatch[1] ?? '';
    const name = extractXmlAttr(attrs, 'name') ?? extractXmlAttr(attrs, 'expert_id') ?? from;
    const outcome = extractXmlAttr(attrs, 'outcome');
    const verdict = humanizeVerdictToken(extractXmlAttr(attrs, 'verdict'));
    const selection = extractElementText(bodyTrimmed, 'selection_reason');
    const plain = stripXmlTags(expertMatch[2] ?? '');
    const body = selection ?? (plain.length > 0 ? plain : outcome ?? '전문가 업데이트가 있습니다.');
    return {
      headline: [name, outcome, verdict].filter(Boolean).join(' · '),
      body,
      severity: outcome === 'failed' ? 'error' : outcome === 'completed' ? 'success' : severity,
      humanized: true,
    };
  }

  // Team roster
  if (/<team_roster\b/i.test(bodyTrimmed)) {
    const names = Array.from(bodyTrimmed.matchAll(/\bname="([^"]+)"/gi)).map((match) => match[1]!);
    const unique = Array.from(new Set(names)).slice(0, 6);
    return {
      headline: '팀 로스터',
      body: unique.length > 0
        ? `참가: ${unique.join(', ')}${names.length > unique.length ? '…' : ''}`
        : '팀 구성을 공유했습니다.',
      severity: 'info',
      humanized: true,
    };
  }

  // Debate envelope
  if (/<debate\b/i.test(bodyTrimmed)) {
    const phase = extractElementText(bodyTrimmed, 'current_phase')
      ?? /current_phase[">\s]+([a-z-]+)/i.exec(bodyTrimmed)?.[1];
    const artifact = extractElementText(bodyTrimmed, 'artifact');
    const instruction = extractElementText(bodyTrimmed, 'instruction');
    return {
      headline: phase !== undefined ? `토론 · ${phase}` : '토론',
      body: instruction ?? artifact ?? '토론 라운드가 진행 중입니다.',
      severity: 'info',
      humanized: true,
    };
  }

  // Integration report
  if (/<integration_report\b/i.test(bodyTrimmed)) {
    const headline = extractElementText(bodyTrimmed, 'headline') ?? '통합 리포트';
    const openGaps = extractElementText(bodyTrimmed, 'open_gaps');
    return {
      headline: '통합',
      body: openGaps !== undefined ? `${headline} · 남은 갭: ${openGaps}` : headline,
      severity: openGaps !== undefined ? 'warning' : 'success',
      humanized: true,
    };
  }

  // VERDICT lines
  const verdictLine = /^\s*VERDICT\s*:\s*(.+)$/im.exec(bodyTrimmed);
  if (verdictLine?.[1] !== undefined) {
    const token = humanizeVerdictToken(verdictLine[1]);
    return {
      headline: '판정',
      body: token ?? collapseWhitespace(verdictLine[1]),
      severity: token === '차단/실패' ? 'error' : token === '통과' ? 'success' : 'info',
      humanized: true,
    };
  }

  // Debate draft pack (reviewer handoff)
  if (/<debate_draft_pack\b/i.test(bodyTrimmed) || /<debate_draft\b/i.test(bodyTrimmed)) {
    const drafts = Array.from(
      bodyTrimmed.matchAll(/<debate_draft\b([^>]*)>([\s\S]*?)<\/debate_draft>/gi),
    );
    const summaries = drafts.slice(0, 4).map((match) => {
      const attrs = match[1] ?? '';
      const work = extractXmlAttr(attrs, 'work_node');
      const phase = extractXmlAttr(attrs, 'phase');
      const author = extractXmlAttr(attrs, 'author');
      const excerpt = stripXmlTags(match[2] ?? '').slice(0, 160);
      return [work, phase, author].filter(Boolean).join(' · ') + (excerpt ? `: ${excerpt}` : '');
    });
    return {
      headline: '토론 초안 팩',
      body:
        summaries.length > 0
          ? summaries.join(' | ')
          : '리뷰어용 토론 초안 팩을 전달했습니다.',
      severity: 'info',
      humanized: true,
    };
  }

  // Dependency handoff between phases
  if (/<dependency_handoff\b/i.test(bodyTrimmed) || /<upstream\b/i.test(bodyTrimmed)) {
    const upstream = Array.from(bodyTrimmed.matchAll(/<upstream\b([^>]*)>/gi)).map((match) => {
      const attrs = match[1] ?? '';
      const expertId = extractXmlAttr(attrs, 'expert_id');
      const phase = extractXmlAttr(attrs, 'phase');
      const verdict = humanizeVerdictToken(extractXmlAttr(attrs, 'verdict'));
      return [expertId, phase, verdict].filter(Boolean).join(' · ');
    });
    const unique = Array.from(new Set(upstream.filter((line) => line.length > 0))).slice(0, 5);
    return {
      headline: '의존 핸드오프',
      body: unique.length > 0 ? `상류: ${unique.join(' | ')}` : '상위 단계 결과를 전달했습니다.',
      severity: 'info',
      humanized: true,
    };
  }

  // Work node contracts
  if (/<work_node_contracts\b/i.test(bodyTrimmed) || /<node\b[^>]*\bid=/i.test(bodyTrimmed)) {
    const ids = Array.from(bodyTrimmed.matchAll(/\bid="([^"]+)"/gi)).map((m) => m[1]!);
    const unique = Array.from(new Set(ids)).slice(0, 6);
    return {
      headline: '작업 노드 계약',
      body:
        unique.length > 0
          ? `노드: ${unique.join(', ')}${ids.length > unique.length ? '…' : ''}`
          : 'WorkGraph 노드 계약을 공유했습니다.',
      severity: 'info',
      humanized: true,
    };
  }

  // Review revision request
  if (/<review_revision_request\b/i.test(bodyTrimmed) || /<prior_review\b/i.test(bodyTrimmed)) {
    const reviews = Array.from(bodyTrimmed.matchAll(/<prior_review\b([^>]*)>/gi)).map((match) => {
      const attrs = match[1] ?? '';
      const expertId = extractXmlAttr(attrs, 'expert_id');
      const verdict = humanizeVerdictToken(extractXmlAttr(attrs, 'verdict'));
      return [expertId, verdict].filter(Boolean).join(' · ');
    });
    return {
      headline: '리뷰 수정 요청',
      body:
        reviews.length > 0
          ? reviews.slice(0, 4).join(' | ')
          : '리뷰 피드백에 따른 수정 라운드가 요청되었습니다.',
      severity: 'warning',
      humanized: true,
    };
  }

  // Channel / collaboration rules (usually system preamble)
  if (/<swarm_channel_rules\b/i.test(bodyTrimmed) || /<collaboration_required\b/i.test(bodyTrimmed)) {
    const plain = stripXmlTags(bodyTrimmed).slice(0, 200);
    return {
      headline: '협업 규칙',
      body: plain.length > 0 ? plain : '스웜 협업 채널 규칙을 안내했습니다.',
      severity: 'neutral',
      humanized: true,
    };
  }

  // Generic XML fallback
  const plain = stripXmlTags(bodyTrimmed);
  return {
    headline: from,
    body: plain.length > 0 ? plain : '프로토콜 메시지를 받았습니다.',
    severity,
    humanized: true,
  };
}
