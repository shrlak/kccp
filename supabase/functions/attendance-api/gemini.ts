// ── 카드 사진 인식 모델 — pure request/response plumbing ──────────────────────
// Shapes the vision request and parses the response for the 새가족 등록 카드
// photo-extraction endpoint (/api/admin/extract-card). Pure only — no fetch, no
// Deno APIs — so it stays unit-testable (gemini.test.ts) like auth.ts.
// The enum vocabulary below must match web/src/features/admin/newFamilyCard.ts
// exactly: the client clamps against those same constants after extraction.
//
// Handwritten Korean+English is hard, and every model here is on a free tier, so a
// single request walks a chain of models (CARD_MODELS) until one returns readable
// cards: a model that is rate-limited, unavailable, times out, or answers with
// nothing parseable simply hands off to the next one.

// Google AI Studio (free tier) — key: GEMINI_API_KEY.
const GOOGLE_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// OpenRouter's `:free` model pool — key: OPENROUTER_API_KEY. Optional: with no key
// configured these entries are skipped and the chain is Google-only.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Kept for callers/tests that referenced the original single-model endpoint.
export const GEMINI_URL = GOOGLE_URL("gemini-2.5-flash");

// Gemini 3세대인가. 그 세대는 요청 모양이 다르다 — temperature/top_p/top_k는 물러났고
// (보내면 무시되거나 거절된다), 대신 thinking_level과 media_resolution이 생겼다. 판단을
// 모델 id의 세대 숫자로만 하므로 CARD_MODEL_CHAIN에 손으로 적어 넣은 새 id도 같이 걸린다.
export function isGen3Model(model: string): boolean {
  const m = /^gemini-(\d+)/.exec(model);
  return m ? Number(m[1]) >= 3 : false;
}

export type CardProvider = "google" | "openrouter";

export interface CardModel {
  id: string; // stable key used in CARD_MODEL_CHAIN and the audit detail
  label: string; // shown to the admin next to the extracted card
  provider: CardProvider;
  model: string; // provider-side model id
}

// Free-tier vision models that can read handwriting, best-first. Google's structured
// output makes the Gemini flash line the reliable default; the rest are fallbacks for
// when it is rate-limited or returns nothing. Model ids come and go on the free pool, so
// the chain is overridable at runtime with the CARD_MODEL_CHAIN env var (comma-
// separated ids) — no code deploy needed to drop a retired model.
// **Head of the chain is gemini-3.6-flash**: still free-tier, and a generation better at
// exactly the two things this endpoint is bad at — handwritten Korean, and several cards
// in one frame (each card is then a fraction of the photo). The 2.x entries stay below it
// as fallbacks, so a bad day on the new model is a slower read, not a failed one.
export const CARD_MODELS: CardModel[] = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google", model: "gemini-3.6-flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", model: "gemini-3.5-flash" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", model: "gemini-2.5-flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", provider: "google", model: "gemini-3.5-flash-lite" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", model: "gemini-2.5-pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google", model: "gemini-2.0-flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "google", model: "gemini-2.5-flash-lite" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", provider: "google", model: "gemini-2.0-flash-lite" },
  { id: "qwen2.5-vl-72b", label: "Qwen2.5-VL 72B", provider: "openrouter", model: "qwen/qwen2.5-vl-72b-instruct:free" },
  { id: "qwen2.5-vl-32b", label: "Qwen2.5-VL 32B", provider: "openrouter", model: "qwen/qwen2.5-vl-32b-instruct:free" },
  { id: "mistral-small-3.2", label: "Mistral Small 3.2", provider: "openrouter", model: "mistralai/mistral-small-3.2-24b-instruct:free" },
  { id: "gemma-3-27b", label: "Gemma 3 27B", provider: "openrouter", model: "google/gemma-3-27b-it:free" },
  { id: "gemma-3-12b", label: "Gemma 3 12B", provider: "openrouter", model: "google/gemma-3-12b-it:free" },
  { id: "llama-3.2-11b-vision", label: "Llama 3.2 11B Vision", provider: "openrouter", model: "meta-llama/llama-3.2-11b-vision-instruct:free" },
  { id: "kimi-vl-a3b", label: "Kimi VL A3B", provider: "openrouter", model: "moonshotai/kimi-vl-a3b-thinking:free" },
];

// Korean prompt describing the paper card's layout and reading rules. One photo may
// hold several cards (a stack laid out on a table, two cards side by side), so the
// answer is always an array — one object per card.
// 두 부서가 서로 다른 종이를 쓴다. 사진 한 장에 여러 장이 찍혀 있을 수 있으므로 답은 언제나
// 배열이고, **각 카드가 어느 종이인지는 카드가 스스로 말한다** (cardType) — 머리글이 다르다.
//   대학·청년부: "KCCP 빛주사랑 대학청년부 - 새가족 등록 카드"
//   장년부:      "새교우 방문, 등록 카드" / "주님의 이름으로 환영 합니다!"
const CARD_KINDS = [
  "이 이미지에는 KCCP의 새가족 카드가 한 장 이상 찍혀 있습니다 (손글씨 한국어/영어).",
  "카드는 두 종류이고 머리글로 구별합니다:",
  '  · cardType "youth" — "KCCP 빛주사랑 대학청년부 - 새가족 등록 카드". 소속(대학생/대학원생/직장인), 카톡ID, 신앙생활 칸이 있습니다.',
  '  · cardType "adult" — "새교우 방문, 등록 카드" 또는 "주님의 이름으로 환영 합니다!". 성명을 한글/영문 두 칸으로 받고, 주소(City/State/Zip), 참석동기, 교회등록 여부, 동행가족 표가 있습니다.',
  "각 카드마다 cardType을 먼저 정하고, **그 종류의 칸만** 채우세요. 다른 종류의 칸은 전부 null입니다.",
];

const CARD_RULES_COMMON = [
  "사진 속 카드를 모두 찾아 각 카드마다 JSON 객체 하나를 만들고, 배열로 반환하세요.",
  "먼저 사진에 카드가 몇 장 있는지 세고, **배열의 길이를 그 장수와 똑같이** 맞추세요.",
  "책상에 여러 장을 늘어놓거나 겹쳐 놓고 한 번에 찍는 일이 흔합니다. 각도가 서로 다르거나",
  "일부가 가려져 있어도 종이 한 장은 카드 한 장입니다.",
  "한 장을 두 개의 객체로 쪼개지 말고, 두 장을 한 객체에 합치지도 마세요.",
  "",
  "규칙:",
  "1. 성별은 ( 남 / 여 ) 중 동그라미·체크된 쪽입니다.",
  "2. 체크박스·괄호 항목은 표시된 라벨 하나만 고르세요.",
  "3. 날짜는 YYYY-MM-DD로 변환하세요.",
  "   대학·청년부 카드는 MM / DD / YYYY 순, 장년부 카드는 년(Y) / 월(M) / 일(D) 순으로 적혀 있습니다.",
  "   두 자리 연도는 생년월일이면 19xx/20xx 중 자연스러운 쪽으로, 등록일이면 20xx로 해석하세요.",
  "   장년부 카드의 생년월일은 년만 적혀 있는 경우가 많습니다. 그럴 때는 birthDate를 \"2006\"처럼 년만 쓰고, 월·일을 지어내지 마세요.",
  "4. 전화번호는 적힌 숫자 그대로 옮기세요 (하이픈 등 구분 기호 포함 가능).",
  "5. '목사님 심방 요청'은 O에 표시가 있으면 true, X에 표시가 있으면 false입니다.",
  "   O와 X 어디에도 아무 표시가 없으면 반드시 null입니다. 표시가 없는 것을 false로 쓰지 마세요.",
  "6. 비어 있거나 판독할 수 없는 칸은 null로 두세요. 절대 추측하지 마세요.",
  "7. 카드가 여러 장이면 사진 속 위치 순서(위→아래, 왼쪽→오른쪽)로 배열에 담으세요.",
  "   카드끼리 내용을 섞지 말고, 각 카드는 그 카드에 적힌 값만으로 채우세요.",
  "   카드가 한 장이면 원소가 하나인 배열을 반환하세요.",
  "8. 일부만 보이거나 기울어진 카드도 칸을 읽을 수 있으면 포함하고, 보이지 않는 칸은 null로 두세요.",
  "   카드가 아닌 배경·빈 종이·중복 촬영본은 배열에 넣지 마세요.",
  "9. 장년부 카드의 동행가족 표는 적힌 줄만 family 배열에 담고, 빈 줄은 넣지 마세요.",
  "   동행가족은 카드가 아닙니다 — 그 카드의 family 안에만 두고, 배열에 따로 원소를 만들지 마세요.",
  "10. 같은 카드를 두 번 담지 마세요. 다만 이름이 같아도 다른 종이에 적혀 있으면 서로 다른 카드입니다",
  "    (가족이 나란히 적어 낸 카드가 그렇습니다) — 한 장으로 합치지 마세요.",
];

// 장년부 링크로 들어온 사진은 장년부 카드만 받는다 — 그 링크가 그 부의 것이기 때문이다.
const ADULT_ONLY = [
  '이 이미지의 카드는 모두 장년부 "새교우 방문, 등록 카드"입니다. cardType은 언제나 "adult"입니다.',
  "대학·청년부 카드가 섞여 있으면 배열에 넣지 마세요.",
];

export const CARD_PROMPT = [...CARD_KINDS, ...CARD_RULES_COMMON].join("\n");
export const CARD_PROMPT_ADULT = [...ADULT_ONLY, ...CARD_RULES_COMMON].join("\n");

// Structured-output schema (Gemini's OpenAPI subset — uppercase types). Every
// field nullable: null means "blank or illegible", never a guess.
export const CARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    // 어느 종이인가. 이 값이 아래 두 묶음 중 어느 쪽이 채워졌는지를 말한다.
    cardType: { type: "STRING", enum: ["youth", "adult"], nullable: true },
    name: { type: "STRING", nullable: true },
    gender: { type: "STRING", enum: ["남", "여"], nullable: true },
    phone: { type: "STRING", nullable: true },
    kakaoId: { type: "STRING", nullable: true },
    birthDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    affiliationCategory: { type: "STRING", enum: ["대학생", "대학원생", "직장인", "Other"], nullable: true },
    affiliationDetail: { type: "STRING", nullable: true, description: "학교/전공 or 직장" },
    baptismStatus: { type: "STRING", enum: ["유아세례", "입교", "세례", "해당없음"], nullable: true },
    faithDuration: { type: "STRING", enum: ["모태신앙", "1년 미만", "1-3년", "3-5년", "5년 이상"], nullable: true },
    registrationDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    // Structured output makes the model fill every field, and an unmarked O/X box is
    // exactly where it likes to volunteer `false` — spell out that no mark means null.
    pastoralVisitRequested: {
      type: "BOOLEAN",
      nullable: true,
      description: "O 표시=true, X 표시=false, 아무 표시 없음=null",
    },
    // ── 장년부 카드에만 있는 칸들 (cardType "youth"이면 전부 null) ──
    nameEn: { type: "STRING", nullable: true, description: "영문 성명" },
    phoneHome: { type: "STRING", nullable: true, description: "집/기타 전화" },
    email: { type: "STRING", nullable: true, description: "이메일 칸에 적힌 것 그대로 (카톡 번호를 적기도 한다)" },
    address: { type: "STRING", nullable: true, description: "주소 한 줄 (City/State/Zip 제외)" },
    city: { type: "STRING", nullable: true },
    state: { type: "STRING", nullable: true },
    zipCode: { type: "STRING", nullable: true },
    attendReason: { type: "STRING", enum: ["moved", "visiting", "training", "study"], nullable: true, description: "이사/방문/연수/유학" },
    registrationChoice: { type: "STRING", enum: ["register", "later", "pastor"], nullable: true, description: "등록을 원합니다/나중에 결정/목사의 연락·상담 원함" },
    visitDate: { type: "STRING", nullable: true, description: "방문 일자 YYYY-MM-DD" },
    memberNo: { type: "STRING", nullable: true, description: "교우 등록번호" },
    schoolOrWork: { type: "STRING", nullable: true, description: "직장 또는 학교명" },
    family: {
      type: "ARRAY",
      nullable: true,
      description: "동행가족 표에 적힌 줄만",
      items: {
        type: "OBJECT",
        properties: {
          nameKo: { type: "STRING", nullable: true },
          nameEn: { type: "STRING", nullable: true },
          relation: { type: "STRING", nullable: true },
          birthDate: { type: "STRING", nullable: true },
          gender: { type: "STRING", nullable: true },
          baptism: { type: "STRING", nullable: true },
        },
      },
    },
  },
  // required는 대학·청년부 칸만 — 장년부 칸까지 강제하면 청년부 카드 한 장을 읽을 때도
  // 스무 개 넘는 null을 지어내야 해서, 이미 잘 돌던 판독이 흔들린다.
  required: [
    "cardType",
    "name", "gender", "phone", "kakaoId", "birthDate", "affiliationCategory",
    "affiliationDetail", "baptismStatus", "faithDuration", "registrationDate",
    "pastoralVisitRequested",
  ],
};

// One photo → one card object per card visible in it. A single card is an array of one,
// so the endpoint has exactly one response shape to handle.
export const CARDS_SCHEMA = { type: "ARRAY", items: CARD_SCHEMA, minItems: 1 };

// Models without server-side schema enforcement (the OpenRouter pool) get the shape
// spelled out in the prompt instead, plus the same enum vocabulary.
const SCHEMA_HINT = [
  "",
  "출력은 오직 JSON 배열 하나입니다. 설명·주석·마크다운 코드펜스를 쓰지 마세요.",
  "각 원소는 다음 키를 모두 가진 객체입니다 (값이 없으면 null):",
  '{"name":string|null,"gender":"남"|"여"|null,"phone":string|null,"kakaoId":string|null,' +
    '"birthDate":"YYYY-MM-DD"|null,"affiliationCategory":"대학생"|"대학원생"|"직장인"|"Other"|null,' +
    '"affiliationDetail":string|null,"baptismStatus":"유아세례"|"입교"|"세례"|"해당없음"|null,' +
    '"faithDuration":"모태신앙"|"1년 미만"|"1-3년"|"3-5년"|"5년 이상"|null,' +
    '"registrationDate":"YYYY-MM-DD"|null,"pastoralVisitRequested":true|false|null,' +
    '"cardType":"youth"|"adult",' +
    '"nameEn":string|null,"phoneHome":string|null,"email":string|null,"address":string|null,' +
    '"city":string|null,"state":string|null,"zipCode":string|null,"schoolOrWork":string|null,' +
    '"attendReason":"moved"|"visiting"|"training"|"study"|null,' +
    '"registrationChoice":"register"|"later"|"pastor"|null,' +
    '"visitDate":"YYYY-MM-DD"|null,"memberNo":string|null,' +
    '"family":[{"nameKo":string|null,"nameEn":string|null,"relation":string|null,"birthDate":string|null,"gender":string|null,"baptism":string|null}]|null}',
].join("\n");

export const CARD_PROMPT_FREEFORM = CARD_PROMPT + "\n" + SCHEMA_HINT;
export const CARD_PROMPT_ADULT_FREEFORM = CARD_PROMPT_ADULT + "\n" + SCHEMA_HINT;

// Resolve the model chain to walk for one request. `spec` is the CARD_MODEL_CHAIN env
// var: comma-separated CARD_MODELS ids, or raw provider model ids for anything not in
// the table (a "vendor/model" id is OpenRouter's, everything else Google's) so a newly
// released free model can be slotted in without a deploy. Empty/blank → CARD_MODELS.
export function cardModelChain(spec?: string | null): CardModel[] {
  const ids = (spec || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return CARD_MODELS;
  return ids.map((id) => {
    const known = CARD_MODELS.find((m) => m.id === id || m.model === id);
    if (known) return known;
    const provider: CardProvider = id.includes("/") ? "openrouter" : "google";
    return { id, label: id, provider, model: id };
  });
}

// Only models whose provider key is configured can be called. Keeps the chain honest
// when OPENROUTER_API_KEY is unset (the default) — those entries are simply skipped.
export function availableCardModels(chain: CardModel[], keys: Partial<Record<CardProvider, string>>): CardModel[] {
  return chain.filter((m) => Boolean(keys[m.provider]));
}

// Does this model take the Gemini 3 knobs below? Only Google's own gen-3 endpoints do —
// the endpoint uses this to decide whether a 400 is worth one plain-body retry.
export function hasGen3Options(model: CardModel): boolean {
  return model.provider === "google" && isGen3Model(model.model);
}

// The HTTP call for one model: url + headers + body, ready for fetch().
// `plain` drops the Gemini 3-only generationConfig knobs — the retry for a deployment
// that answers 400 because it doesn't know one of them yet.
export function buildCardRequest(
  model: CardModel,
  image: string,
  mediaType: string,
  apiKey: string,
  only?: "adult",
  plain = false,
): { url: string; headers: Record<string, string>; body: unknown } {
  if (model.provider === "openrouter") {
    return {
      url: OPENROUTER_URL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers — optional, but they keep free-tier requests
        // identifiable rather than anonymous.
        "HTTP-Referer": "https://shrlak.github.io/kccp/",
        "X-Title": "KCCP Attendance",
      },
      body: {
        model: model.model,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
            { type: "text", text: only === "adult" ? CARD_PROMPT_ADULT_FREEFORM : CARD_PROMPT_FREEFORM },
          ],
        }],
      },
    };
  }
  return {
    url: GOOGLE_URL(model.model),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: buildGeminiBody(image, mediaType, only, model.model, plain),
  };
}

// generateContent request body: image part first, prompt second; responseSchema for
// directly parseable JSON.
// `only` narrows what the model is allowed to come back with: 장년부 링크로 들어온 사진은
// 장년부 카드만 받는다. 비워 두면 두 종류를 다 읽고 cardType으로 알려 준다.
export function buildGeminiBody(
  image: string,
  mediaType: string,
  only?: "adult",
  model = "",
  plain = false,
) {
  const text = only === "adult" ? CARD_PROMPT_ADULT : CARD_PROMPT;
  return {
    contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text }] }],
    generationConfig: geminiGenerationConfig(model, plain),
  };
}

// 세대마다 다이얼이 다르다.
//   2.x — temperature 0으로 답을 고정한다.
//   3.x — temperature/top_p/top_k는 물러났으므로 보내지 않는다. 대신 두 개를 켠다:
//     · media_resolution HIGH — 사진 한 장에 카드가 여러 장이면 카드 하나가 화면의 일부라
//       기본 해상도로는 손글씨가 뭉갠다. 이 endpoint가 가장 자주 지는 자리다.
//     · thinking_level low — 20초 예산 안에 답이 와야 한다 (CARD_MODEL_TIMEOUT_MS).
//       기본값(medium)은 카드 여러 장 × 스무 개 넘는 칸에서 그 예산을 넘길 수 있고,
//       칸을 옮겨 적는 일에 긴 사고는 값을 하지 않는다.
function geminiGenerationConfig(model: string, plain: boolean): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: CARDS_SCHEMA,
  };
  if (!isGen3Model(model)) {
    cfg.temperature = 0;
    return cfg;
  }
  if (!plain) {
    cfg.thinking_level = "low";
    cfg.media_resolution = "MEDIA_RESOLUTION_HIGH";
  }
  return cfg;
}

// Provider response → list of cards. Null when the model gave nothing usable, which
// is the endpoint's signal to try the next model in the chain.
export function parseCardResponse(model: CardModel, resp: unknown): Record<string, unknown>[] | null {
  return model.provider === "openrouter" ? parseOpenRouterCards(resp) : parseGeminiCards(resp);
}

// Pull the structured JSON out of a generateContent response as a list of cards.
// A bare object (model ignored the array schema) is accepted as a one-card list;
// null on anything unexpected (no candidates, safety block, non-JSON text, empty
// list, no object entries).
export function parseGeminiCards(resp: unknown): Record<string, unknown>[] | null {
  if (!resp || typeof resp !== "object") return null;
  const r = resp as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (r.promptFeedback?.blockReason) return null;
  const parts = r.candidates?.[0]?.content?.parts;
  // 생각 요약(`thought: true`)은 답이 아니다 — Gemini 3부터 같은 parts 배열에 섞여 올 수
  // 있으므로 걷어낸다. 섞인 채로 이으면 JSON 앞에 산문이 붙는다.
  const text = parts?.filter((p) => !p?.thought).map((p) => p?.text)
    .filter((t) => typeof t === "string").join("") || "";
  return cardsFromText(text);
}

// OpenAI-shaped chat completion (OpenRouter). These models answer in prose-adjacent
// JSON — code fences, a preamble — so the text goes through the lenient extractor.
export function parseOpenRouterCards(resp: unknown): Record<string, unknown>[] | null {
  if (!resp || typeof resp !== "object") return null;
  const r = resp as { choices?: { message?: { content?: unknown } }[]; error?: unknown };
  if (r.error) return null;
  const content = r.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    // Some models answer with the multi-part content array instead of a string.
    : Array.isArray(content)
    ? content.map((c) => (c && typeof c === "object" ? (c as { text?: string }).text : "")).filter(Boolean).join("")
    : "";
  return cardsFromText(text);
}

// Text → card list. Parses the whole string first (what a structured-output model
// returns), then falls back to the first JSON array/object embedded in it, so a
// ```json fence or a chatty preamble doesn't cost a whole extraction.
export function cardsFromText(text: unknown): Record<string, unknown>[] | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  for (const candidate of [stripped, sliceJson(stripped, "[", "]"), sliceJson(stripped, "{", "}")]) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cards = list.filter(
      (c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c),
    );
    if (cards.length) return cards;
  }
  return null;
}

// First balanced-looking JSON span between `open` and its last matching `close`.
function sliceJson(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}
