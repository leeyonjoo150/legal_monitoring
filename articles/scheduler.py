from datetime import timedelta

from django.utils import timezone

from articles.collectors.naver import collect_all_news
from articles.analyzers.gemini import analyze_with_retry
from articles.models import Article


def collect_and_analyze():
    """기사 수집 → 중복 제거 → Gemini 분석 → DB 저장 파이프라인."""
    print(f"\n{'='*50}")
    print(f"[스케줄러] 수집 시작: {timezone.now()}")
    print(f"{'='*50}")

    # 1. 네이버 뉴스 수집
    raw_articles = collect_all_news()

    # 2. URL 기준 DB 중복 제거
    existing_urls = set(
        Article.objects.values_list('url', flat=True)
    )
    new_articles = [a for a in raw_articles if a['url'] not in existing_urls]
    print(f"[필터] 신규 기사: {len(new_articles)}건 (기존 DB 제외)")

    if not new_articles:
        print("[완료] 신규 기사 없음")
        return

    # 3. 최근 30일 기사 목록 (중복 사건 판단용)
    thirty_days_ago = timezone.now() - timedelta(days=30)
    existing_articles = list(
        Article.objects.filter(collected_at__gte=thirty_days_ago)
        .values('title', 'defendant', 'case_category')
    )

    # 4. Gemini 분석 + 저장
    saved_count = 0
    skipped_duplicate = 0

    for article in new_articles:
        result = analyze_with_retry(article, existing_articles)

        if result is None:
            continue

        if result.get('is_duplicate', False):
            skipped_duplicate += 1
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
        )
        saved_count += 1

        # 새로 저장한 기사를 기존 목록에 추가 (이후 분석에 반영)
        existing_articles.append({
            'title': article['title'],
            'defendant': result['defendant'],
            'case_category': result['case_category'],
        })

    print(f"\n[완료] 저장: {saved_count}건 / 중복 사건: {skipped_duplicate}건 / 분석 실패: {len(new_articles) - saved_count - skipped_duplicate}건")


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
