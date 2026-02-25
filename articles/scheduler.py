from datetime import datetime, timedelta

from django.utils import timezone

from articles.collectors.naver import collect_all_news
from articles.analyzers.gemini import analyze_with_retry
from articles.models import Article, SkippedURL
from articles.progress import (
    start_collection, start_analysis, update_progress, update_result, finish,
)

# 경과 시간별 키워드당 수집 건수
DISPLAY_TIERS = [
    (2,   30),   # ~ 2시간: 정상 운영 (근무 중)
    (24,  50),   # ~ 1일: 퇴근 → 다음날 출근
    (96,  80),   # ~ 4일: 금요일 퇴근 → 월요일 출근
    (None, 100), # 4일 초과: 골든위크 등 장기 휴일 (API 최대)
]


def _get_display_count() -> int:
    """마지막 수집 이후 경과 시간에 따라 키워드당 수집 건수를 결정."""
    last_article = (
        Article.objects.order_by('-collected_at')
        .values_list('collected_at', flat=True).first()
    )
    last_skipped = (
        SkippedURL.objects.order_by('-skipped_at')
        .values_list('skipped_at', flat=True).first()
    )

    candidates = [t for t in [last_article, last_skipped] if t is not None]

    if not candidates:
        # DB에 데이터 없음 = 첫 수집 → 최대치
        return 100

    last_collected = max(candidates)
    elapsed_hours = (datetime.now() - last_collected).total_seconds() / 3600

    for max_hours, display in DISPLAY_TIERS:
        if max_hours is None or elapsed_hours <= max_hours:
            return display

    return 100


def collect_and_analyze():
    """기사 수집 → 중복 제거 → Gemini 분석 → DB 저장 파이프라인."""
    print(f"\n{'='*50}")
    print(f"[스케줄러] 수집 시작: {timezone.now()}")
    print(f"{'='*50}")

    # 진행상황: 수집 시작
    start_collection()

    try:
        # 1. 경과 시간에 따라 수집량 결정 + 네이버 뉴스 수집
        display_count = _get_display_count()
        print(f"[수집량] 키워드당 {display_count}건 (경과 시간 기반 자동 설정)")
        raw_articles = collect_all_news(display=display_count)

        # 2. URL 기준 DB 중복 제거 (Article + SkippedURL 통합 체크)
        existing_urls = set(
            Article.objects.values_list('url', flat=True)
        )
        skipped_urls = set(
            SkippedURL.objects.values_list('url', flat=True)
        )
        all_known_urls = existing_urls | skipped_urls
        new_articles = [a for a in raw_articles if a['url'] not in all_known_urls]
        print(f"[필터] 신규 기사: {len(new_articles)}건 (Article {len(existing_urls)}건 + SkippedURL {len(skipped_urls)}건 제외)")

        if not new_articles:
            print("[완료] 신규 기사 없음")
            return

        # 진행상황: 분석 시작
        start_analysis(total=len(new_articles))

        # 3. 최근 30일 기사 목록 (중복 사건 판단용)
        thirty_days_ago = timezone.now() - timedelta(days=30)
        existing_articles = list(
            Article.objects.filter(collected_at__gte=thirty_days_ago)
            .values('title', 'defendant', 'case_category')
        )

        # 4. Gemini 분석 + 저장
        saved_count = 0
        skipped_duplicate = 0
        failed_count = 0

        for idx, article in enumerate(new_articles, 1):
            # 진행상황 업데이트
            update_progress(current=idx, title=article['title'][:60])

            result = analyze_with_retry(article, existing_articles)

            if result is None:
                failed_count += 1
                update_result(saved=saved_count, skipped_duplicate=skipped_duplicate, failed=failed_count)
                continue

            if result.get('is_duplicate', False):
                SkippedURL.objects.get_or_create(url=article['url'])
                skipped_duplicate += 1
                update_result(saved=saved_count, skipped_duplicate=skipped_duplicate, failed=failed_count)
                print(f"[중복 사건] 건너뜀: {article['title'][:50]}")
                continue

            Article.objects.create(
                title=article['title'],
                url=article['url'],
                description=article['description'],
                press=article['press'],
                published_at=article['published_at'],
                suitability=result['suitability'],
                suitability_reason=result['suitability_reason'],
                case_category=result['case_category'],
                defendant=result['defendant'],
                damage_scale=result['damage_scale'],
                stage=result['stage'],
                stage_detail=result['stage_detail'],
                summary=result['summary'],
                region=result['region'],
            )
            saved_count += 1
            update_result(saved=saved_count, skipped_duplicate=skipped_duplicate, failed=failed_count)

            # 새로 저장한 기사를 기존 목록에 추가 (이후 분석에 반영)
            existing_articles.append({
                'title': article['title'],
                'defendant': result['defendant'],
                'case_category': result['case_category'],
            })

        print(f"\n[완료] 저장: {saved_count}건 / 중복 사건: {skipped_duplicate}건 / 분석 실패: {failed_count}건")
    finally:
        # 항상 완료 상태로 전환
        finish()


def start_scheduler():
    """APScheduler를 설정하고 시작."""
    from datetime import datetime

    from apscheduler.schedulers.background import BackgroundScheduler
    from django_apscheduler.jobstores import DjangoJobStore

    scheduler = BackgroundScheduler()
    scheduler.add_jobstore(DjangoJobStore(), 'default')

    scheduler.add_job(
        collect_and_analyze,
        trigger='interval',
        hours=1,
        id='collect_and_analyze',
        max_instances=1,
        replace_existing=True,
        next_run_time=datetime.now(),
    )

    scheduler.start()
    print("[스케줄러] 즉시 첫 수집 실행 + 1시간 간격 자동 수집 시작됨")
