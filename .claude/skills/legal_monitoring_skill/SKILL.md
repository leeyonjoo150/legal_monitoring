---
name: legal-radar
description: 소송금융 투자 검토를 위한 뉴스 기사 자동 수집 및 AI 분석 시스템 구축. 네이버 뉴스 API로 기사를 수집하고 Gemini LLM으로 소송금융 적합도를 분석하여 Django 대시보드로 시각화하는 POC 수준의 로컬 실행 프로젝트.
---

# Legal Radar - 뉴스 모니터링 프로젝트

로앤굿의 소송금융 투자 검토를 위한 뉴스 기사 자동 수집 및 분석 시스템이다.
네이버 뉴스 검색 API로 관련 기사를 수집하고, Gemini API로 소송금융 적합도를 분석하여 Django 대시보드에 표시한다.

---

## 커뮤니케이션 규칙

- **모든 소통은 한국어로 한다.**
- **터미널 명령이 필요한 경우, 직접 실행하지 않고 사용자에게 명령어를 알려주고 실행을 요청한다.**
  - 예: "아래 명령어를 터미널에서 실행해주세요: `pip install django`"
- 코드 작성, 파일 생성, 설정 안내는 직접 수행한다.

---

## 기술 스택

| 항목 | 선택 | 이유 |
|------|------|------|
| 백엔드 프레임워크 | Django | 협업 편의성, ORM, Admin 내장 |
| 데이터베이스 | SQLite | Python 내장, 별도 설치 불필요 |
| 기사 수집 | 네이버 뉴스 검색 API | 법적으로 안전한 공식 API |
| AI 분석 | Gemini API (Flash) | 무료 티어로 POC 수준 충분 |
| 스케줄러 | django-apscheduler | Django 내에서 별도 서버 없이 동작 |
| 프론트엔드 | HTML + CSS + JavaScript (Django Template) | POC 수준에 적합, 오버스펙 방지 |
| 엑셀 내보내기 | openpyxl | Django와 연동 용이 |

---

## 버전 기준 및 개발 주의사항

**Python 3.12** / **Django 5.2 LTS** 기준으로 개발한다.
코드 작성 시 아래 버전별 주의사항을 반드시 준수한다.

### Python 3.12
- `typing` 모듈의 `Union`, `Optional` 대신 `X | Y`, `X | None` 문법 사용
- `match-case` 구문 사용 가능

### Django 5.2
- `urls.py`에서 `path()` 사용 (구버전 `url()` 사용 금지)
- 모델 `Meta`에서 `default_auto_field` 는 `BigAutoField` 기본값 사용
- `INSTALLED_APPS`에 `django_apscheduler` 등록 필요
- `settings.py`에서 `DATABASES` 기본값 SQLite 그대로 사용

### google-generativeai 0.8.x
- `genai.configure(api_key=...)` 로 초기화
- `genai.GenerativeModel(model_name='gemini-1.5-flash')` 로 모델 지정
- `.generate_content()` 로 호출, 응답은 `.text` 로 접근
- 구버전 `palm` 관련 API 사용 금지

### django-apscheduler 0.7.x
- `DjangoJobStore` 사용
- `scheduler.add_job()` 으로 잡 등록
- `apps.py`의 `ready()` 메서드에서 스케줄러 시작

### openpyxl 3.1.x
- `Workbook()` → `ws = wb.active` → `ws.append(row)` 패턴 사용
- 스타일 적용 시 `PatternFill`, `Font` 임포트해서 사용

---

## 프로젝트 구조

```
legal_radar/
├── manage.py
├── requirements.txt
├── legal_radar/              # Django 프로젝트 설정
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── articles/                 # 기사 수집·분석 앱
│   ├── models.py             # Article 모델
│   ├── views.py              # 대시보드, 내보내기
│   ├── urls.py
│   ├── admin.py
│   ├── scheduler.py          # APScheduler 설정
│   ├── collectors/
│   │   └── naver.py          # 네이버 API 수집
│   └── analyzers/
│       └── gemini.py         # Gemini 분석
├── templates/
│   └── articles/
│       ├── dashboard.html    # 메인 대시보드
│       └── detail.html       # 기사 상세
└── static/
    ├── css/
    └── js/
```

---

## 데이터 처리 흐름

```
[1] APScheduler → 1시간마다 트리거
        ↓
[2] 네이버 뉴스 API → 키워드 7개로 기사 수집
    수집 항목: 제목, URL, 요약문(description), 언론사, 게재일
        ↓
[3] URL 기준으로 이미 DB에 있는 기사 제외
    (메모리에서 처리 / LLM 호출 낭비 방지)
        ↓
[4] Gemini API로 1초 간격 순차 분석 (실패 시 메모리에서 최대 3회 재시도)
    ┌─ 분석 항목 ─────────────────────────────────┐
    │  - 소송금융 적합도 (High/Medium/Low + 판단 근거) │
    │  - 사건 분야                                  │
    │  - 상대방                                     │
    │  - 피해 규모                                  │
    │  - 진행 단계 / 진행 단계 상세                  │
    │  - 요약 (2~3문장)                             │
    └──────────────────────────────────────────────┘
    ┌─ 사건 중복 판단 (분석과 동시에) ────────────────┐
    │  최근 30일 DB 저장 기사의                       │
    │  [제목 + 상대방 + 사건분야] 목록을 함께 전달      │
    │  → Gemini가 "같은 사건"인지 맥락으로 판단        │
    │  → 제목이 달라도 같은 사건이면 is_duplicate=true │
    └──────────────────────────────────────────────┘
        ↓
[5] is_duplicate=true 이면 저장 안 함 / false 이면 SQLite에 저장
    (DB 저장은 딱 1회)
        ↓
[6] Django 대시보드에서 조회
        ↓
[7] 필요 시 .xlsx 파일로 내보내기
```

---

## 데이터 모델

### Article 모델 (`articles/models.py`)

```python
class Article(models.Model):
    # 수집 정보
    title = models.CharField(max_length=500)
    url = models.URLField(unique=True)
    description = models.TextField()        # 네이버 API 요약문 (100~200자)
    press = models.CharField(max_length=100)
    published_at = models.DateTimeField()
    collected_at = models.DateTimeField(auto_now_add=True)

    # 분석 결과
    suitability = models.CharField(
        max_length=10,
        choices=[('High', 'High'), ('Medium', 'Medium'), ('Low', 'Low')]
    )
    suitability_reason = models.TextField()
    case_category = models.CharField(max_length=100)   # 사건 분야
    defendant = models.CharField(max_length=200)       # 상대방
    damage_scale = models.TextField()                  # 피해 규모
    stage = models.CharField(max_length=50)            # 진행 단계
    stage_detail = models.CharField(max_length=200)    # 진행 단계 상세
    summary = models.TextField()                       # 2~3문장 요약

    class Meta:
        ordering = ['-published_at']
```

---

## 수집 키워드 목록

코드에 고정값으로 관리한다. 변경 시 `articles/collectors/naver.py` 파일의 `KEYWORDS` 리스트를 수정한다.

```python
KEYWORDS = [
    "소송",
    "손해배상",
    "집단소송",
    "공동소송",
    "피해자",
    "피해보상",
    "피해구제",
]
```

---

## Gemini 분석 프롬프트 구조

### 페르소나
> "소송금융 투자를 검토하는 심사역. 원칙적인 법률 전문가의 면과 공격적으로 수임 기회를 포착하는 비즈니스 전략가의 면을 모두 갖춤."

### 프롬프트 입력 구성
```
[분석 대상 기사]
- 제목: {title}
- 요약문: {description}

[기존 사건 목록] (최근 30일 DB 저장 기사)
- 제목: {existing_title} / 상대방: {existing_defendant} / 사건분야: {existing_category}
- 제목: {existing_title} / 상대방: {existing_defendant} / 사건분야: {existing_category}
...
```

### 사건 중복 판단 기준 (프롬프트에 명시)
Gemini에게 아래 기준을 프롬프트에 명확히 지시한다.

> "기존 사건 목록과 비교하여 분석 대상 기사가 **동일한 사건**을 다루고 있으면 is_duplicate를 true로 설정하라.
> 동일한 사건이란 기사 제목이 같은 것이 아니라, **같은 피해 주체가 같은 원인으로 피해를 입은 사건**을 의미한다.
> 예를 들어 '넥슨 집단소송 제기'와 '메이플 피해자 법적 대응'은 제목이 달라도 같은 사건이므로 is_duplicate=true이다.
> 반면 같은 기업이 피고여도 사건의 원인이 다르면 별개 사건이므로 is_duplicate=false이다."

### 응답 형식 (JSON)
```json
{
  "is_duplicate": false,
  "suitability": "High",
  "suitability_reason": "판단 근거",
  "case_category": "개인정보",
  "defendant": "ㅇㅇ기업",
  "damage_scale": "피해자 약 3,000명, 피해액 미상",
  "stage": "관련 절차 진행",
  "stage_detail": "개인정보보호위원회 조사 중",
  "summary": "2~3문장 요약"
}
```

`is_duplicate`가 `true`이면 DB에 저장하지 않고 넘어간다.
`is_duplicate`가 `false`이면 분석 결과 전체를 DB에 저장한다.

---

## 소송금융 적합도 판단 기준

### 적합 조건

| 조건 | 설명 |
|------|------|
| 상대방 책임이 비교적 명확함 | 잘못을 저지른 주체가 구체적으로 특정됨 |
| 상대방에게 자력이 충분함 | 대기업, 금융기관, 보험사, 상장회사, 공공기관 등 |
| 집단적 피해 | 동일 원인으로 다수(수십 명 이상)가 피해 |
| 피해 규모가 큼 | 수억 원 이상 또는 수만 명 이상 |
| 증거가 있거나 확보 가능함 | 공식 조사 결과, 정부 발표 등 객관적 증거 존재 |
| 이미 공적 절차(소송 제외)가 진행 중임 | 검찰 수사, 정부 조사, 행정처분 등 |

### 부적합 조건

| 조건 | 설명 |
|------|------|
| 이미 종결된 사건 | 합의 완료, 판결 확정 등 |

### 판정 기준
- **High**: 적합 조건 4개 이상 + 부적합 조건 없음
- **Medium**: 적합 조건 2~3개 + 부적합 조건 없음
- **Low**: 적합 조건 1개 이하 / 또는 부적합 조건 1개 이상 해당

---

## 진행 단계 분류

| 단계 | 설명 |
|------|------|
| 피해 발생 | 피해 사실만 보도, 법적 조치 없음 |
| 관련 절차 진행 | 검찰·경찰 수사, 감독기관 조사, 행정처분 진행 중 또는 완료 |
| 소송중 | 피해자가 손해배상 소송 제기 |
| 판결 선고 | 1심/2심 판결 또는 가처분 결과 |
| 종결 | 판결 확정 또는 대법원 판결 등 사건 종결 |

---

## Gemini API 호출 관리

### 무료 티어 기준 (Gemini 1.5 Flash)
- 분당 15회 / 하루 1,500회

### 예상 사용량
- 1시간 수집 × 24회/일 × 최대 신규 20~30건 = 약 480~720회/일
- 무료 티어 내 충분히 동작

### 적용 규칙
1. 기사 1건당 1초 간격으로 순차 호출 (분당 제한 방지)
2. 이미 DB에 저장된 URL은 재분석 없음
3. 하루 호출 수를 카운트하여 1,400회 초과 시 콘솔 경고 출력

### 유료 전환 시
`analyzers/gemini.py`의 `CALL_INTERVAL` (기본값 1초) 을 줄이거나 제거하고,
`DAILY_LIMIT` 경고 임계값을 조정하면 된다.

---

## 재시도 로직

LLM 호출 실패(네트워크 오류, API 한도 등) 시 메모리에서 재시도한다.
DB 저장 전 단계에서 처리하므로 DB에는 성공한 결과만 저장된다.

```python
import time

def analyze_with_retry(article, recent_titles, max_retry=3):
    for attempt in range(max_retry):
        try:
            result = call_gemini_api(article, recent_titles)
            return result
        except Exception as e:
            if attempt < max_retry - 1:
                time.sleep(2)
            else:
                print(f"[분석 실패] 건너뜀: {article['url']} / 오류: {e}")
                return None
```

`None` 반환 시 해당 기사는 저장하지 않고 다음 기사로 넘어간다.

---

## 대시보드 구성

### 메인 대시보드 (`/`)
- 필터: 소송 적합도 (High/Medium/Low), 사건 분야, 진행 단계, 날짜 범위
- 정렬: 게재일 최신순 (기본값)
- 목록 표시 항목: 제목, 언론사, 게재일, 적합도 뱃지, 사건 분야, 상대방, 진행 단계
- 상단 요약: 오늘 수집 건수, High 건수, Medium 건수

### 기사 상세 (`/articles/<id>/`)
- 전체 분석 결과 표시 (가이드라인 항목 전체)
- 원문 링크 버튼

### 엑셀 내보내기 (`/export/`)
- 현재 필터 조건 그대로 `.xlsx` 파일 다운로드
- 컬럼: 제목, 언론사, 게재일, 적합도, 판단 근거, 사건 분야, 상대방, 피해 규모, 진행 단계, 진행 단계 상세, 요약, 원문 링크

---

## 환경 변수 설정 (`.env`)

```
NAVER_CLIENT_ID=네이버_API_클라이언트_ID
NAVER_CLIENT_SECRET=네이버_API_클라이언트_시크릿
GEMINI_API_KEY=제미나이_API_키
SECRET_KEY=Django_시크릿_키
DEBUG=True
```

---

## 초기 설정 순서

사용자에게 아래 순서로 안내하고, 터미널 명령은 직접 실행하지 않고 사용자에게 요청한다.

1. **API 키 발급 안내**
   - 네이버 개발자 센터(https://developers.naver.com)에서 뉴스 검색 API 신청
   - Google AI Studio(https://aistudio.google.com)에서 Gemini API 키 발급

2. **패키지 설치** (사용자에게 실행 요청)
   ```bash
   pip install django django-apscheduler google-generativeai requests python-dotenv openpyxl
   ```

3. **Django 프로젝트 생성** (사용자에게 실행 요청)
   ```bash
   django-admin startproject legal_radar
   cd legal_radar
   python manage.py startapp articles
   ```

4. **`.env` 파일 생성 및 API 키 입력** (사용자가 직접 작성)
   ```bash
   cp .env.example .env
   ```
   `.env` 파일을 열어 각 항목에 실제 API 키를 입력한다.
   `.env` 파일은 절대 Git에 커밋하지 않는다. `.gitignore`에 `.env`가 포함되어 있는지 반드시 확인한다.

5. **마이그레이션** (사용자에게 실행 요청)
   ```bash
   python manage.py makemigrations
   python manage.py migrate
   ```

6. **서버 실행** (사용자에게 실행 요청)
   ```bash
   python manage.py runserver
   ```

---

## 주요 라이브러리 참고

| 라이브러리 | 용도 | 공식 문서 |
|-----------|------|----------|
| django-apscheduler | 1시간 간격 스케줄링 | https://github.com/jcass77/django-apscheduler |
| google-generativeai | Gemini API 호출 | https://ai.google.dev/gemini-api/docs |
| openpyxl | xlsx 파일 생성 | https://openpyxl.readthedocs.io |
| python-dotenv | 환경 변수 관리 | https://pypi.org/project/python-dotenv |

---

## 향후 확장 고려사항 (POC 이후)

- 키워드 관리 화면 (Django Admin 활용)
- 찜 기능 (로그인 기능 추가 후 연동)
- 벡터DB 도입으로 중복 판단 고도화 (기사량 증가 시)
- Gemini 유료 플랜 전환 및 호출 속도 최적화
- 구글시트 API 직접 연동 (엑셀 내보내기 대체)
- 서버 배포 (AWS, GCP 등)
