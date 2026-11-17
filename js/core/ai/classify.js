// 질문 종류 어림(기록용). 규칙 기반 초안이다 — 확인된 척도가 아니라 고쳐 갈 초안이고, 정확도를 재지 않았다.
// 값은 data/schema.mjs 의 ai_question.qType 과 같다. 위에서부터 먼저 맞는 것을 고른다.
export const QUESTION_TYPES = ['answer_only', 'meaning', 'why_step', 'check_calc', 'other_explanation', 'other'];

const RULES = [
  ['answer_only', /(정답|답)(이|을|만|좀)?\s*(뭐|뭔|무엇|알려|가르쳐|말해|좀)|답만|그냥\s*답|풀어\s*줘|대신\s*풀|얼마\s*(야|예요|에요|인가요)\s*\??$/],
  ['check_calc', /(내|제)\s*(풀이|답|계산)|(맞|틀)(는지|렸는지|았는지|게)\s*(확인|봐)|계산.{0,6}(맞|틀)|확인해\s*(줘|주세요|봐)/],
  ['why_step', /왜|이유|어째서|어떻게\s*(이|그)렇게|이\s*단계|무슨\s*까닭/],
  ['other_explanation', /다시\s*설명|쉽게|쉬운\s*말|다르게\s*설명|다른\s*설명|예를\s*들/],
  ['meaning', /뜻|무슨\s*말|무슨\s*의미|의미|이란|란\s*뭐|뭐야|뭔가요|무엇인가|뭐예요|뭐에요/],
];

export function questionType(text) {
  const s = String(text ?? '').normalize('NFC');
  for (const [type, re] of RULES) if (re.test(s)) return type;
  return 'other';
}
