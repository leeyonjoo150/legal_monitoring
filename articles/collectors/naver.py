import re
from datetime import datetime, timezone, timedelta

import requests
from django.conf import settings

KST = timezone(timedelta(hours=9))

KEYWORDS = [
    "소송",
    "손해배상",
    "집단소송",
    "공동소송",
    "피해자",
    "피해보상",
    "피해구제",
]

NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/news.json"


def _clean_html(text: str) -> str:
    """HTML 태그 및 특수문자 제거."""
    text = re.sub(r'<[^>]+>', '', text)
    text = text.replace('&quot;', '"').replace('&amp;', '&')
    text = text.replace('&lt;', '<').replace('&gt;', '>')
    return text.strip()


def _parse_pub_date(date_str: str) -> datetime:
    """네이버 API의 pubDate를 한국 시간(naive datetime)으로 변환."""
    dt = datetime.strptime(date_str, '%a, %d %b %Y %H:%M:%S %z')
    dt_kst = dt.astimezone(KST)
    return dt_kst.replace(tzinfo=None)


def fetch_news_for_keyword(keyword: str, display: int = 20) -> list[dict]:
    """단일 키워드로 네이버 뉴스 검색 API를 호출하여 기사 목록 반환."""
    headers = {
        'X-Naver-Client-Id': settings.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': settings.NAVER_CLIENT_SECRET,
    }
    params = {
        'query': keyword,
        'display': display,
        'sort': 'date',
    }

    response = requests.get(NAVER_SEARCH_URL, headers=headers, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()

    articles = []
    for item in data.get('items', []):
        articles.append({
            'title': _clean_html(item['title']),
            'url': item['originallink'] or item['link'],
            'description': _clean_html(item['description']),
            'press': _extract_press(item['originallink'] or item['link']),
            'published_at': _parse_pub_date(item['pubDate']),
        })
    return articles


PRESS_MAP = {
    # 종합일간지
    'khan.co.kr': '경향신문',
    'kmib.co.kr': '국민일보',
    'donga.com': '동아일보',
    'munhwa.com': '문화일보',
    'seoul.co.kr': '서울신문',
    'segye.com': '세계일보',
    'chosun.com': '조선일보',
    'joongang.co.kr': '중앙일보',
    'hani.co.kr': '한겨레',
    'hankookilbo.com': '한국일보',
    # 통신사
    'news1.kr': '뉴스1',
    'newsis.com': '뉴시스',
    'yna.co.kr': '연합뉴스',
    'yonhapnewstv.co.kr': '연합뉴스TV',
    # 방송사
    'channela.com': '채널A',
    'wowtv.co.kr': '한국경제TV',
    'jtbc.co.kr': 'JTBC',
    'kbs.co.kr': 'KBS',
    'imbc.com': 'MBC',
    'mbn.co.kr': 'MBN',
    'sbs.co.kr': 'SBS',
    'sbsbiz.co.kr': 'SBS Biz',
    'tvchosun.com': 'TV조선',
    'ytn.co.kr': 'YTN',
    # 경제지
    'mk.co.kr': '매일경제',
    'mt.co.kr': '머니투데이',
    'bizwatch.co.kr': '비즈워치',
    'sedaily.com': '서울경제',
    'asiae.co.kr': '아시아경제',
    'edaily.co.kr': '이데일리',
    'biz.chosun.com': '조선비즈',
    'joseilbo.com': '조세일보',
    'fnnews.com': '파이낸셜뉴스',
    'hankyung.com': '한국경제',
    'heraldcorp.com': '헤럴드경제',
    # 인터넷신문
    'nocutnews.co.kr': '노컷뉴스',
    'tf.co.kr': '더팩트',
    'dailian.co.kr': '데일리안',
    'mediatoday.co.kr': '미디어오늘',
    'inews24.com': '아이뉴스24',
    'ohmynews.com': '오마이뉴스',
    'pressian.com': '프레시안',
    # IT전문
    'ddaily.co.kr': '디지털데일리',
    'dt.co.kr': '디지털타임스',
    'bloter.net': '블로터',
    'etnews.com': '전자신문',
    'zdnet.co.kr': '지디넷코리아',
    # 시사/주간지
    'thescoop.co.kr': '더스쿠프',
    'mk.co.kr/premium': '매경이코노미',
    'sisain.co.kr': '시사IN',
    'sisajournal.com': '시사저널',
    'shindonga.donga.com': '신동아',
    'economist.co.kr': '이코노미스트',
    'weekly.khan.co.kr': '주간경향',
    'weekly.donga.com': '주간동아',
    'weekly.chosun.com': '주간조선',
    'sunday.joongang.co.kr': '중앙SUNDAY',
    'h21.hani.co.kr': '한겨레21',
    'magazine.hankyung.com': '한경비즈니스',
    # 전문/특수
    'journalist.or.kr': '기자협회보',
    'nongmin.com': '농민신문',
    'newstapa.org': '뉴스타파',
    'dongascience.com': '동아사이언스',
    'lawtimes.co.kr': '법률신문',
    'legaltimes.co.kr': '리걸타임즈',
    'womennews.co.kr': '여성신문',
    'ildaro.com': '일다',
    'koreajoongangdaily.joins.com': '코리아중앙데일리',
    'koreaherald.com': '코리아헤럴드',
    'kormedi.com': '코메디닷컴',
    'health.chosun.com': '헬스조선',
    # 지역
    'kado.net': '강원도민일보',
    'kwnews.co.kr': '강원일보',
    'kyeonggi.com': '경기일보',
    'kookje.co.kr': '국제신문',
    'daejonilbo.com': '대전일보',
    'imaeil.com': '매일신문',
    'busan.com': '부산일보',
    'jmbc.co.kr': '전주MBC',
    'cjb.co.kr': 'CJB청주방송',
    'jibs.co.kr': 'JIBS',
    'ikbc.co.kr': 'KBC광주방송',
}


def _extract_press(link: str) -> str:
    """링크에서 언론사 이름을 추출."""
    try:
        from urllib.parse import urlparse
        domain = urlparse(link).netloc.replace('www.', '')
        # 정확히 매칭
        if domain in PRESS_MAP:
            return PRESS_MAP[domain]
        # 부분 매칭 (서브도메인 포함)
        for key, name in PRESS_MAP.items():
            if key in domain:
                return name
        return domain
    except Exception:
        return '알 수 없음'


def collect_all_news(display: int = 20) -> list[dict]:
    """모든 키워드로 기사를 수집하고 URL 기준 중복 제거 후 반환."""
    all_articles: dict[str, dict] = {}

    for keyword in KEYWORDS:
        try:
            articles = fetch_news_for_keyword(keyword, display=display)
            for article in articles:
                url = article['url']
                if url not in all_articles:
                    all_articles[url] = article
        except Exception as e:
            print(f"[수집 오류] 키워드 '{keyword}': {e}")

    print(f"[수집 완료] 총 {len(all_articles)}건 (중복 제거 후)")
    return list(all_articles.values())
