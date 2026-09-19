// Configuration for score recognition. Recognition works through an ordered
// list of ATTEMPTS — each one an engine plus a specific model — tried top to
// bottom until one succeeds. The order is managed in 관리자 설정 and stored
// on the shared recognition proxy (see worker/), so a change made on one
// device applies to everyone; localStorage keeps the last-known order as an
// offline cache. There is no per-user settings screen — recognition works
// out of the box with the defaults below.

export type RecognitionEngine = 'gemini' | 'openrouter' | 'off';

/** One recognition try: an engine and the exact model it should use. */
export interface RecognitionAttempt {
  engine: Exclude<RecognitionEngine, 'off'>;
  model: string;
}

/**
 * What a model is currently allowed to do.
 *
 * 'champion'   — one of the three models every page is read by.
 * 'challenger' — called only for a page the champions were not sure about.
 * 'paused'     — failing or regressing; not called at all until it recovers.
 */
export type ModelRole = 'champion' | 'challenger' | 'paused';

export interface RecognitionModelInfo extends RecognitionAttempt {
  /** Short human label shown in 관리자 설정. */
  label: string;
  /** One-line description of when this model shines. */
  note: string;
  /** Starting role, used until measured reliability takes over (see modelReliability.ts). */
  role: ModelRole;
  /**
   * Exact slug the request is forwarded to. It differs from `model` only for
   * the legacy suffix-free Nemotron ID, which stored settings still carry;
   * every OpenRouter route ends in `:free` so the shared key can never be
   * spent on a paid model.
   */
  upstreamModel: string;
}

/**
 * Map an engine name from stored settings onto a current one.
 *
 * The OpenRouter lane was originally called 'nvidia' because Nemotron was its
 * only model. Renaming it in place would have invalidated every device's
 * cached settings, so the old name is migrated here instead.
 */
export function migrateEngineName(value: unknown): 'gemini' | 'openrouter' | undefined {
  if (value === 'gemini') return 'gemini';
  if (value === 'openrouter' || value === 'nvidia') return 'openrouter';
  return undefined;
}

/** True unless this entry would route an OpenRouter call to a non-free model. */
export function isFreeVisionCatalogEntry(entry: RecognitionModelInfo): boolean {
  return entry.engine !== 'openrouter' || entry.upstreamModel.endsWith(':free');
}

/**
 * The complete model pool, grouped by provider for stable display. This is the
 * single source of truth: the concurrent model pool, the sanitizer, and the
 * proxy's OpenRouter allowlist all derive from it.
 *
 * Each entry declares a starting ROLE. Champions read every page; challengers
 * are called only for a page the champions disagreed on (see
 * adaptiveRecognition.ts). These are starting values only — once a model has
 * enough verified corrections behind it, measured reliability decides its role
 * instead (see modelReliability.ts).
 *
 * ENTRY BAR: a model earns a slot only if it is (a) genuinely free — free API
 * tier or an OpenRouter `:free` endpoint — and (b) currently among the
 * strongest free vision models for this job, which is reading small Korean
 * lyric type under a staff and recovering the part labels and 진행 순서 from
 * the page. Weak or superseded models are removed rather than kept as a last
 * resort: an extra answer that is usually wrong costs accuracy in the merge
 * (line-level consensus lets models outvote each other) and burns free quota
 * that a strong model could have spent.
 */
export const RECOGNITION_MODEL_CATALOG: RecognitionModelInfo[] = [
  // Google's free tier carries Flash and Flash-Lite only (Pro models left it
  // in April 2026), so the two strongest Flash releases are the primaries.
  // They meter against separate quotas, so running both costs nothing extra.
  {
    engine: 'gemini',
    model: 'gemini-3.6-flash',
    upstreamModel: 'gemini-3.6-flash',
    role: 'champion',
    label: 'Gemini 3.6 Flash',
    note: '주 모델 — 현재 무료 티어에서 가장 강력한 Gemini (10 RPM · 1,500 RPD)',
  },
  {
    engine: 'gemini',
    model: 'gemini-3.5-flash',
    upstreamModel: 'gemini-3.5-flash',
    role: 'champion',
    label: 'Gemini 3.5 Flash',
    note: '주 모델 — 별도 무료 한도를 가진 상위 Gemini (15 RPM · 1,500 RPD)',
  },
  {
    engine: 'openrouter',
    model: 'nvidia/nemotron-nano-12b-v2-vl',
    upstreamModel: 'nvidia/nemotron-nano-12b-v2-vl:free',
    role: 'champion',
    label: 'NVIDIA Nemotron Nano 12B VL · OpenRouter Free',
    note: '주 모델 — 문서 OCR·표 인식 특화로 악보의 작은 가사 글씨에 강합니다',
  },
  {
    engine: 'openrouter',
    model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    upstreamModel: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    role: 'challenger',
    label: 'NVIDIA Nemotron 3 Nano Omni 30B (reasoning) · Free',
    note: '교차 검증 — 추론형 멀티모달, 1절·2절이 겹쳐 적힌 악보의 구조 판단에 강합니다',
  },
  {
    engine: 'openrouter',
    model: 'dots-studio/dots-3-note-preview:free',
    upstreamModel: 'dots-studio/dots-3-note-preview:free',
    role: 'challenger',
    label: 'dots.note 3 (preview) · Free',
    note: '교차 검증 — 필기·인쇄가 섞인 문서 이미지에 특화된 신규 무료 모델',
  },
  {
    engine: 'openrouter',
    model: 'google/gemma-4-31b-it:free',
    upstreamModel: 'google/gemma-4-31b-it:free',
    role: 'challenger',
    // gemma-4-26b-a4b-it was benchmarked and rejected; do not re-add it.
    note: '교차 검증 — Gemini와 다른 계열의 오독을 잡아내는 대형 오픈 웨이트 모델',
    label: 'Google Gemma 4 31B IT · Free',
  },
];

/** Stable display/storage order; execution starts every entry concurrently. */
export const DEFAULT_ATTEMPT_ORDER: RecognitionAttempt[] = RECOGNITION_MODEL_CATALOG.map(
  ({ engine, model }) => ({ engine, model }),
);

/**
 * Titles that must never appear in 찬양 편집 — songs the fixed slides
 * already cover (공동체 고백송) or that are sung before the service starts.
 * Editable in 관리자 설정; matching is normalized-substring, so an entry
 * matches a recognized title that contains it.
 */
export const DEFAULT_EXCLUDED_TITLES: string[] = ['공동체 고백송', '예배 전 준비 찬양'];

/**
 * 공동체 고백송으로 부르는 곡. 그 곡의 가사 슬라이드는 **고정된 back-slides 안에**
 * 있으므로, 생성기가 그 블록을 이 곡으로 고쳐 쓴다 — 그리고 콘티에서 이 곡을
 * 「슬라이드를 만들어야 하는 곡」에서 갈라내는 것도 같은 값이다.
 * 기본값은 번들된 back 덱이 이미 찍어 두고 있는 곡이다.
 */
export const DEFAULT_CONFESSION_SONG = 'Celebrate the Light';

/** The part of the settings shared across every device via the proxy. */
export interface SharedRecognitionSettings {
  attempts: RecognitionAttempt[];
  excludedTitles: string[];
  /**
   * 이번 시즌의 공동체 고백송 제목. 곡 라이브러리에서 찾아 back 덱의 공동체 고백
   * 블록을 고쳐 쓴다. **빈 문자열은 "back slides를 받은 그대로 둔다"**는 뜻이다.
   */
  confessionSong: string;
  /**
   * Roles the administrator pinned by hand, keyed by `engine:model`.
   *
   * Measured accuracy decides roles on its own. This exists for the cases
   * measurement cannot see yet: a provider announcing a deprecation, or a
   * model that has started returning something odd in a way the pause rules
   * have not caught. An override always wins.
   */
  roleOverrides: Partial<Record<string, ModelRole>>;
}

export const DEFAULT_SHARED_SETTINGS: SharedRecognitionSettings = {
  attempts: [...DEFAULT_ATTEMPT_ORDER],
  excludedTitles: [...DEFAULT_EXCLUDED_TITLES],
  confessionSong: DEFAULT_CONFESSION_SONG,
  roleOverrides: {},
};

/**
 * 인식 설정. **키 칸은 없다.**
 *
 * ppt에는 geminiApiKey · openrouterApiKey 가 있었다. 정적 사이트라 프록시가 없는
 * 배포도 가능했고, 그때는 사람이 자기 키를 붙여 넣어 썼다. 합쳐진 앱에서 그 길은
 * **막아야 하는 길**이다: 브라우저가 상류를 직접 부르면 영역 검사(`areaOf`)도
 * 무료 한도 계량(`record_ai_usage`)도 지나가지 않는다. 키는 함수 시크릿에만 있다.
 */
export interface AiSettings extends SharedRecognitionSettings {
  /** Model for the quick title-identification pass (speed matters there). */
  geminiModel: string;
  /** Cross-check recognized lyrics against the web via Gemini's Google Search grounding. */
  geminiUseSearch: boolean;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  attempts: [...DEFAULT_ATTEMPT_ORDER],
  excludedTitles: [...DEFAULT_EXCLUDED_TITLES],
  confessionSong: DEFAULT_CONFESSION_SONG,
  roleOverrides: {},
  geminiModel: DEFAULT_GEMINI_MODEL,
  geminiUseSearch: true,
};

export function attemptKey(attempt: RecognitionAttempt): string {
  return `${attempt.engine}:${attempt.model}`;
}

export function findModelInfo(attempt: RecognitionAttempt): RecognitionModelInfo | undefined {
  const engine = migrateEngineName(attempt.engine);
  if (!engine) return undefined;
  return RECOGNITION_MODEL_CATALOG.find((entry) => entry.engine === engine && entry.model === attempt.model);
}

/**
 * Coerce a stored/received value into a valid attempt order: keep only
 * catalog entries, drop duplicates, then append whichever catalog models are
 * missing (in default order) so newly added models are always reachable and
 * every model appears exactly once. Legacy plain-engine entries ("gemini")
 * from the pre-catalog format expand into that engine's catalog models, and
 * the legacy "nvidia" engine name is migrated to "openrouter" with its model
 * left untouched.
 */
export function sanitizeAttemptOrder(raw: unknown): RecognitionAttempt[] {
  const seen = new Set<string>();
  const order: RecognitionAttempt[] = [];
  const push = (attempt: RecognitionAttempt) => {
    const key = attemptKey(attempt);
    if (!seen.has(key)) {
      seen.add(key);
      order.push({ engine: attempt.engine, model: attempt.model });
    }
  };
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === 'string') {
        // Legacy format: an engine name — expand to its catalog models.
        const engine = migrateEngineName(value);
        if (!engine) continue;
        for (const entry of RECOGNITION_MODEL_CATALOG) {
          if (entry.engine === engine) push(entry);
        }
        continue;
      }
      const candidate = value as Partial<RecognitionAttempt> | null;
      if (!candidate || typeof candidate.model !== 'string') continue;
      const engine = migrateEngineName(candidate.engine);
      if (!engine) continue;
      const known = RECOGNITION_MODEL_CATALOG.find(
        (entry) => entry.engine === engine && entry.model === candidate.model,
      );
      // A model that is not in the catalog — a paid route, or one this build
      // no longer ships — is dropped rather than silently swapped for another.
      if (known && isFreeVisionCatalogEntry(known)) push(known);
    }
  }
  for (const entry of DEFAULT_ATTEMPT_ORDER) push(entry);
  return order;
}

/**
 * Coerce a stored/received exclusion list: non-empty trimmed strings only,
 * deduplicated (case/spacing-insensitively), capped to sane sizes.
 */
export function sanitizeExcludedTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EXCLUDED_TITLES];
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const title = value.trim().slice(0, 100);
    if (!title) continue;
    const key = title.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= 100) break;
  }
  return titles;
}

/**
 * 저장되거나 받아 온 공동체 고백송 제목을 다듬는다. 문자열이 아니면 기본값(번들된
 * back 덱이 찍는 곡)으로 떨어지고, **비워 둔 것은 그대로 남긴다** — 그것이
 * "back slides를 건드리지 않는다"는 뜻이기 때문이다.
 */
export function sanitizeConfessionSong(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_CONFESSION_SONG;
  return raw.trim().slice(0, 100);
}

/**
 * Keep only overrides that name a catalog model and a real role. An override
 * for a model this build no longer ships would otherwise sit in shared
 * settings forever, invisible and unexplained.
 */
export function sanitizeRoleOverrides(raw: unknown): Partial<Record<string, ModelRole>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const roles: ModelRole[] = ['champion', 'challenger', 'paused'];
  const overrides: Partial<Record<string, ModelRole>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!roles.includes(value as ModelRole)) continue;
    const known = RECOGNITION_MODEL_CATALOG.find((entry) => attemptKey(entry) === key);
    if (known) overrides[key] = value as ModelRole;
  }
  return overrides;
}

export function sanitizeSharedSettings(raw: unknown): SharedRecognitionSettings {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    attempts: sanitizeAttemptOrder(obj.attempts),
    excludedTitles: sanitizeExcludedTitles(obj.excludedTitles),
    confessionSong: sanitizeConfessionSong(obj.confessionSong),
    roleOverrides: sanitizeRoleOverrides(obj.roleOverrides),
  };
}

/**
 * ── 전송 ─────────────────────────────────────────────────────────────────────
 *
 * ppt에서는 이 아래가 localStorage + Worker 였다. 두 가지가 함께 사라진다:
 *
 * 1. **"이 브라우저의 사본".** 로그인이 없던 앱이라 설정을 기기마다 캐시해 두고
 *    서버와 병합했다. 계정이 생기면 사본은 하나다 — 어느 기기에서 열어도 같은
 *    모델 풀을 본다.
 * 2. **비밀번호 인자.** `pushSharedSettings(settings, password)` 의 그 password 는
 *    로그인이 없는 정적 사이트의 무른 관문이었다(문자열 하나가 코드에 박혀 있었다).
 *    지금은 서버가 최고관리자·소유자인지 확인하므로 인자 자체가 없어진다 — 남겨
 *    두면 아무것도 지키지 않으면서 지키는 것처럼 보인다.
 */
import { getSharedSettings, saveSharedSettings } from './proxy';

/** 프록시는 언제나 있다 — 슬라이드 화면에 들어왔다는 것이 곧 그 자격이다. */
export function hasSharedSettings(): boolean {
  return true;
}

/**
 * 프록시에서 공유 설정을 읽는다. 실패하면 null — 부르는 쪽이 기본값으로 내려간다.
 * 인식이 설정 하나 때문에 멈추면 안 되기 때문이고, 기본값은 카탈로그 전체 순서라
 * 안전한 쪽이다.
 */
export async function fetchSharedSettings(): Promise<SharedRecognitionSettings | null> {
  try {
    return sanitizeSharedSettings(await getSharedSettings());
  } catch {
    return null;
  }
}

/**
 * 새 공유 설정을 올린다. 모든 기기가 다음 인식부터 이것을 쓴다.
 *
 * 서버가 카탈로그 밖의 모델을 **저장할 때도 씻으므로**, 오래된 화면이 유료 모델을
 * 설정에 심을 수 없다. 권한도 서버가 본다 (최고관리자·소유자).
 */
export async function pushSharedSettings(settings: SharedRecognitionSettings): Promise<void> {
  await saveSharedSettings(sanitizeSharedSettings(settings));
  invalidateSharedSettings();
}

// 공유 설정은 한 페이지 로드에 한 번만 읽는다 (인식은 몰아서 돈다). 관리자가 저장하면
// 메모를 버려서 같은 세션이 자기 변경을 곧바로 본다.
let sharedSettingsMemo: Promise<SharedRecognitionSettings | null> | null = null;

export function invalidateSharedSettings(): void {
  sharedSettingsMemo = null;
}

/** 공유 설정을 반영한 인식 설정. 못 읽으면 기본값. */
export async function getSyncedAiSettings(): Promise<AiSettings> {
  if (!sharedSettingsMemo) sharedSettingsMemo = fetchSharedSettings();
  return { ...DEFAULT_AI_SETTINGS, ...((await sharedSettingsMemo) ?? {}) };
}

/** 기다리지 않는 짝 — 기본값 그대로 (테스트와 동기 호출부). */
export function getAiSettings(): AiSettings {
  return { ...DEFAULT_AI_SETTINGS };
}
