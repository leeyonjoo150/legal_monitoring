import json
import time

from google import genai
from google.genai import types
from django.conf import settings

CALL_INTERVAL = 4  # 초 (Tier 1 분당 한도 내 유지)
DAILY_LIMIT = 1400  # 경고 임계값
_daily_call_count = 0

SYSTEM_PROMPT = """당신은 소송금융 투자를 검토하는 심사역입니다.
원칙적인 법률 전문가의 면과 공격적으로 수임 기회를 포착하는 비즈니스 전략가의 면을 모두 갖추고 있습니다.

아래 뉴스 기사를 분석하여 소송금융 투자 적합도를 판단하세요.

## 가상 컨텐츠 제외
기사가 드라마, 영화, 소설, 웹툰, 게임, 예능 등 **가상의 창작물(픽션) 속 사건**을 다루고 있으면 is_fictional을 true로 설정하라.
실제 사건이 아닌 가상 컨텐츠는 분석 대상이 아니다.
예: 드라마 속 소송, 영화 줄거리의 사기 사건, 게임 내 분쟁 스토리 등

## 소송금융 적합도 판단 기준

### 적합 조건
1. 상대방 책임이 비교적 명확함 (잘못을 저지른 주체가 구체적으로 특정됨)
2. 상대방에게 자력이 충분함 (대기업, 금융기관, 보험사, 상장회사, 공공기관 등)
3. 집단적 피해 (동일 원인으로 다수(수십 명 이상)가 피해)
4. 피해 규모가 큼 (수억 원 이상 또는 수만 명 이상)
5. 증거가 있거나 확보 가능함 (공식 조사 결과, 정부 발표 등 객관적 증거 존재)
6. 이미 공적 절차(소송 제외)가 진행 중임 (검찰 수사, 정부 조사, 행정처분 등)

### 부적합 조건
1. 이미 종결된 사건 (합의 완료, 판결 확정 등) → stage가 "종결"이면 suitability는 반드시 "Low"
2. 소송·분쟁 무관 기사: 단순 기업의 인수합병(M&A), 실적 발표, 신제품 출시, 단순 주가 등락(특징주) 소식 등 누군가의 '위법 행위'나 '피해 발생'과 무관한 일반 경제/주식 뉴스는 무조건 suitability를 "Low"로 설정하라. 소송이나 분쟁의 여지가 없는 뉴스 기사는 절대 High나 Medium을 주어서는 안 된다.

### 판정 기준
suitability 값은 반드시 "High", "Medium", "Low" 중 하나만 사용하라. 다른 값은 절대 사용하지 마라.
- High: 적합 조건 4개 이상 + 부적합 조건 없음
- Medium: 적합 조건 2~3개 + 부적합 조건 없음
- Low: 적합 조건 1개 이하 / 또는 부적합 조건 1개 이상 해당

## 진행 단계 분류
stage 값은 반드시 아래 5개 중 하나만 사용하라. 다른 값은 절대 사용하지 마라.
- 피해 발생: 피해 사실만 보도되었고 아직 기사상 나타난 법적 조치 없음
- 관련 절차 진행: 검찰 수사, 경찰 수사, 감독기관 조사, 행정처분이 진행 중이거나 이미 이루어짐
- 소송중: 피해자가 손해배상 소송을 법원에 제기함
- 판결 선고: 1심/2심 판결이 나오거나 가처분 결과가 나옴
- 종결: 판결이 확정되거나 3심(대법원) 판결이 나오는 등 더 이상 다툴 수 없이 사건이 종결됨

기사 내용으로 단계를 판단하기 어려운 경우, 가장 근접한 단계를 선택하라.

## 국내/해외 분류
region 값은 반드시 "국내" 또는 "해외" 중 하나만 사용하라.
- 국내: 대한민국 내에서 발생한 사건
- 해외: 외국에서 발생한 사건 (해외 기업, 해외 법원, 해외 피해자 등)

## 사건 중복 판단 기준
기존 사건 목록과 비교하여 분석 대상 기사가 **동일한 사건**을 다루고 있으면 is_duplicate를 true로 설정하라.
동일한 사건이란 기사 제목이 같은 것이 아니라, **같은 피해 주체가 같은 원인으로 피해를 입은 사건**을 의미한다.
예를 들어 '넥슨 집단소송 제기'와 '메이플 피해자 법적 대응'은 제목이 달라도 같은 사건이므로 is_duplicate=true이다.
반면 같은 기업이 피고여도 사건의 원인이 다르면 별개 사건이므로 is_duplicate=false이다.

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.
```json
{
  "is_fictional": false,
  "is_duplicate": false,
  "duplicate_of_id": null,
  "suitability": "High",
  "suitability_reason": "판단 근거",
  "case_category": "사건 분야",
  "defendant": "상대방",
  "damage_scale": "피해 규모",
  "stage": "진행 단계",
  "stage_detail": "진행 단계 상세",
  "region": "국내",
  "summary": "2~3문장 요약"
}
```"""


def _build_prompt(article: dict, existing_articles: list[dict]) -> str:
    """분석 프롬프트를 생성."""
    prompt = f"""[분석 대상 기사]
- 제목: {article['title']}
- 요약문: {article['description']}

[기존 사건 목록] (최근 30일 DB 저장 기사)
"""
    if existing_articles:
        for ea in existing_articles:
            prompt += f"- id: {ea['id']} / 제목: {ea['title']} / 상대방: {ea['defendant']} / 사건분야: {ea['case_category']}\n"
    else:
        prompt += "- (없음)\n"

    return prompt


def _parse_response(text: str) -> dict | None:
    """Gemini 응답에서 JSON을 추출."""
    text = text.strip()
    # ```json ... ``` 블록 추출
    if '```json' in text:
        start = text.index('```json') + 7
        end = text.index('```', start)
        text = text[start:end].strip()
    elif '```' in text:
        start = text.index('```') + 3
        end = text.index('```', start)
        text = text[start:end].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        print(f"[JSON 파싱 오류] 응답: {text[:200]}")
        return None


VALID_SUITABILITY = {'High', 'Medium', 'Low'}
VALID_STAGES = {'피해 발생', '관련 절차 진행', '소송중', '판결 선고', '종결'}
VALID_REGIONS = {'국내', '해외'}


def _sanitize_result(result: dict, article: dict) -> dict:
    """Gemini 응답을 검증하고 잘못된 값을 기본값으로 보정."""
    # suitability 보정
    if result.get('suitability') not in VALID_SUITABILITY:
        print(f"[보정] suitability '{result.get('suitability')}' → 'Low'")
        result['suitability'] = 'Low'

    # 종결 사건은 반드시 Low
    if result.get('stage') == '종결' and result.get('suitability') != 'Low':
        print(f"[보정] stage=종결이므로 suitability '{result.get('suitability')}' → 'Low'")
        result['suitability'] = 'Low'

    # stage 보정
    if result.get('stage') not in VALID_STAGES:
        print(f"[보정] stage '{result.get('stage')}' → '피해 발생'")
        result['stage'] = '피해 발생'

    # region 보정
    if result.get('region') not in VALID_REGIONS:
        print(f"[보정] region '{result.get('region')}' → '국내'")
        result['region'] = '국내'

    # 누락/null 필드 보정
    defaults = {
        'is_duplicate': False,
        'duplicate_of_id': None,
        'suitability_reason': '정보 부족',
        'case_category': '미분류',
        'defendant': '미상',
        'damage_scale': '미상',
        'stage_detail': '',
        'region': '국내',
        'summary': article.get('description', ''),
    }
    for key, default in defaults.items():
        if not result.get(key) and result.get(key) is not False:
            result[key] = default

    return result


def analyze_article(article: dict, existing_articles: list[dict]) -> dict | None:
    """단일 기사를 Gemini API로 분석."""
    global _daily_call_count

    if _daily_call_count >= DAILY_LIMIT:
        print(f"[경고] 일일 호출 수 {_daily_call_count}회 - 한도 임박")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    prompt = _build_prompt(article, existing_articles)
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
        ),
    )

    _daily_call_count += 1
    time.sleep(CALL_INTERVAL)

    return _parse_response(response.text)


def analyze_with_retry(article: dict, existing_articles: list[dict], max_retry: int = 3) -> dict | None:
    """재시도 로직 포함 분석."""
    for attempt in range(max_retry):
        try:
            result = analyze_article(article, existing_articles)
            if result is not None:
                return _sanitize_result(result, article)
            print(f"[분석 재시도] JSON 파싱 실패 ({attempt + 1}/{max_retry}): {article['title'][:50]}")
        except Exception as e:
            print(f"[분석 오류] ({attempt + 1}/{max_retry}): {e}")

        if attempt < max_retry - 1:
            time.sleep(2)

    print(f"[분석 실패] 건너뜀: {article['url']}")
    return None
