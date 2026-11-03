// AI API 연동 (선택). 키가 없으면 아무것도 안 켜짐 → 기본 사용에 영향 없음.
// 공급자는 바꿔 끼울 수 있게 인터페이스 하나로 통일.

export interface AiRequest {
  /** 역할·규칙 (투자 조언 아님 등) */
  system: string;
  /** 사용자 질문 (매매 기록을 정리한 것) */
  prompt: string;
}

export interface AiProvider {
  /** 화면 표시용 이름 (예: anthropic, gemini) */
  readonly name: string;
  readonly model: string;
  generate(req: AiRequest): Promise<string>;
}

/** 화면에 그대로 보여줄 수 있는 AI 오류 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

/** 기본 모델 (환경변수 AI_MODEL로 바꿀 수 있음) */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const TRUNCATED_NOTE = '\n\n(답변이 길어서 중간에 끊겼어요)';

/** HTTP 상태 → 짧은 한국어 안내 */
function httpMessage(status: number, detail?: string): string {
  if (status === 401 || status === 403) return 'AI API 키가 올바르지 않거나 권한이 없어요';
  if (status === 429) return 'AI 요청이 너무 많아요. 잠시 후 다시 시도해 주세요';
  if (status >= 500) return 'AI 서버가 바빠요. 잠시 후 다시 시도해 주세요';
  return `AI 요청이 거절됐어요${detail ? ` (${detail})` : ''}`;
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  error?: { type?: string; message?: string };
}

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  /** 정책상 거절됐을 때 서버가 다른 모델로 이어서 답하게 함 (기본 모델일 때만 켬) */
  fallbacks?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Anthropic Messages API (SDK 없이 fetch) */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly fallbacks: boolean;

  constructor(private readonly o: AnthropicOptions) {
    this.model = o.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.fallbacks = o.fallbacks ?? this.model === DEFAULT_ANTHROPIC_MODEL;
    this.fetchFn = o.fetch ?? fetch;
  }

  /** 요청 본문·헤더 (테스트에서 확인) */
  buildRequest(req: AiRequest): { headers: Record<string, string>; body: Record<string, unknown> } {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.o.apiKey,
      'anthropic-version': '2026-10-21',
    };
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 16_000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    };
    if (this.fallbacks) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    return { headers, body };
  }

  async generate(req: AiRequest): Promise<string> {
    const { headers, body } = this.buildRequest(req);
    let res: Response;
    try {
      res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 180_000),
      });
    } catch {
      throw new AiError('AI 서버에 연결하지 못했어요');
    }
    const data = (await res.json().catch(() => undefined)) as AnthropicResponse | undefined;
    if (!res.ok) throw new AiError(httpMessage(res.status, data?.error?.message));
    if (data?.stop_reason === 'refusal') throw new AiError('AI가 이 질문에는 답하지 않았어요. 질문을 바꿔서 다시 시도해 주세요');
    const text = (data?.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new AiError('AI 답변이 비어 있어요');
    return data?.stop_reason === 'max_tokens' ? text + TRUNCATED_NOTE : text;
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Google Gemini generateContent (fetch) */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly o: GeminiOptions) {
    this.model = o.model ?? DEFAULT_GEMINI_MODEL;
    this.fetchFn = o.fetch ?? fetch;
  }

  async generate(req: AiRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
      });
    } catch {
      throw new AiError('AI 서버에 연결하지 못했어요');
    }
    const data = (await res.json().catch(() => undefined)) as GeminiResponse | undefined;
    if (!res.ok) throw new AiError(httpMessage(res.status, data?.error?.message));
    if (data?.promptFeedback?.blockReason) throw new AiError('AI가 이 질문에는 답하지 않았어요. 질문을 바꿔서 다시 시도해 주세요');
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    if (!text) throw new AiError('AI 답변이 비어 있어요');
    return cand?.finishReason === 'MAX_TOKENS' ? text + TRUNCATED_NOTE : text;
  }
}

/**
 * 환경변수로 공급자 고르기. 키가 없으면 null (AI 메뉴 숨김).
 * AI_PROVIDER=anthropic|gemini 로 고정 가능, 없으면 ANTHROPIC_API_KEY → GEMINI_API_KEY 순.
 * AI_MODEL로 모델 변경, AI_FALLBACK=off로 거절 시 대체 모델 끄기.
 */
export function aiFromEnv(env: NodeJS.ProcessEnv, fetchFn?: typeof fetch): AiProvider | null {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim() || undefined;
  const pick = env.AI_PROVIDER?.trim().toLowerCase();
  const useGemini = pick === 'gemini' ? Boolean(geminiKey) : !anthropicKey && Boolean(geminiKey);
  if (useGemini && geminiKey) return new GeminiProvider({ apiKey: geminiKey, ...(model ? { model } : {}), ...(fetchFn ? { fetch: fetchFn } : {}) });
  if (anthropicKey && pick !== 'gemini') {
    return new AnthropicProvider({
      apiKey: anthropicKey,
      ...(model ? { model } : {}),
      ...(env.AI_FALLBACK === 'off' ? { fallbacks: false } : {}),
      ...(fetchFn ? { fetch: fetchFn } : {}),
    });
  }
  return null;
}
