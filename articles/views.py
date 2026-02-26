import json
from datetime import datetime

from django.core.paginator import Paginator
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from articles.models import Article
from articles.progress import get_progress

ARTICLES_PER_PAGE = 30


def _get_filtered_queryset(request):
    """요청 파라미터로 필터링된 QuerySet 반환."""
    qs = Article.objects.all()

    suitability = request.GET.get('suitability')
    if suitability:
        qs = qs.filter(suitability=suitability)

    case_category = request.GET.get('case_category')
    if case_category:
        qs = qs.filter(case_category=case_category)

    stage = request.GET.get('stage')
    if stage:
        qs = qs.filter(stage=stage)

    title = request.GET.get('title')
    if title:
        qs = qs.filter(title__icontains=title)

    region = request.GET.get('region')
    if region:
        qs = qs.filter(region=region)

    date_from = request.GET.get('date_from')
    if date_from:
        qs = qs.filter(published_at__gte=datetime.fromisoformat(date_from))

    date_to = request.GET.get('date_to')
    if date_to:
        qs = qs.filter(published_at__lte=datetime.fromisoformat(date_to + 'T23:59:59'))

    is_reviewed = request.GET.get('is_reviewed')
    if is_reviewed == 'true':
        qs = qs.filter(is_reviewed=True)
    elif is_reviewed == 'false':
        qs = qs.filter(is_reviewed=False)

    review_passed = request.GET.get('review_passed')
    if review_passed == 'true':
        qs = qs.filter(review_passed=True)
    elif review_passed == 'false':
        qs = qs.filter(review_passed=False)
    elif review_passed == 'null':
        qs = qs.filter(review_passed__isnull=True)

    return qs


def dashboard(request):
    """메인 대시보드 뷰."""
    articles = _get_filtered_queryset(request)

    today = timezone.now().date()
    today_articles = Article.objects.filter(collected_at__date=today)

    categories = (
        Article.objects.values_list('case_category', flat=True)
        .distinct()
        .order_by('case_category')
    )

    paginator = Paginator(articles, ARTICLES_PER_PAGE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    context = {
        'articles': page_obj,
        'page_obj': page_obj,
        'total_today': today_articles.count(),
        'high_today': today_articles.filter(suitability='High').count(),
        'medium_today': today_articles.filter(suitability='Medium').count(),
        'categories': categories,
        'current_filters': {
            'suitability': request.GET.get('suitability', ''),
            'case_category': request.GET.get('case_category', ''),
            'stage': request.GET.get('stage', ''),
            'region': request.GET.get('region', ''),
            'title': request.GET.get('title', ''),
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
            'is_reviewed': request.GET.get('is_reviewed', ''),
            'review_passed': request.GET.get('review_passed', ''),
        },
    }
    response = render(request, 'articles/dashboard.html', context)
    response['Cache-Control'] = 'no-store'
    return response


def detail(request, article_id):
    """기사 상세 뷰."""
    article = get_object_or_404(Article, pk=article_id)
    related_articles = article.duplicate_articles.filter(
        related_article__isnull=False
    ).order_by('-skipped_at')
    return render(request, 'articles/detail.html', {
        'article': article,
        'related_articles': related_articles,
    })


def export_xlsx(request):
    """현재 필터 조건으로 엑셀 내보내기."""
    articles = _get_filtered_queryset(request)

    wb = Workbook()
    ws = wb.active
    ws.title = '소송금융 모니터링'

    headers = [
        '제목', '언론사', '게재일', '적합도', '판단 근거',
        '사건 분야', '국내/해외', '상대방', '피해 규모', '진행 단계',
        '진행 단계 상세', '요약', '원문 링크',
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color='1F4E79', end_color='1F4E79', fill_type='solid')
    header_font = Font(color='FFFFFF', bold=True, size=11)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font

    for article in articles:
        ws.append([
            article.title,
            article.press,
            article.published_at.strftime('%Y-%m-%d %H:%M'),
            article.suitability,
            article.suitability_reason,
            article.case_category,
            article.region,
            article.defendant,
            article.damage_scale,
            article.stage,
            article.stage_detail,
            article.summary,
            article.url,
        ])

    column_widths = [50, 15, 18, 10, 40, 15, 10, 20, 25, 15, 25, 50, 50]
    for i, width in enumerate(column_widths, 1):
        ws.column_dimensions[chr(64 + i)].width = width

    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    filename = f'legal_radar_{timezone.now().strftime("%Y%m%d_%H%M")}.xlsx'
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    wb.save(response)
    return response


def progress_status(request):
    """분석 진행상황 JSON API."""
    return JsonResponse(get_progress())


@csrf_exempt
def toggle_review(request, article_id):
    """심사 완료 / 통과 여부 토글 API."""
    if request.method != 'POST':
        return JsonResponse({'error': 'method not allowed'}, status=405)

    article = get_object_or_404(Article, pk=article_id)
    data = json.loads(request.body)
    action = data.get('action')

    if action == 'reviewed':
        article.is_reviewed = not article.is_reviewed
        article.save(update_fields=['is_reviewed'])
    elif action == 'passed':
        article.review_passed = data.get('value')
        article.save(update_fields=['review_passed'])

    return JsonResponse({
        'is_reviewed': article.is_reviewed,
        'review_passed': article.review_passed,
    })


def api_articles_latest(request):
    """after_id 이후 저장된 신규 기사 + 오늘 통계 반환."""
    try:
        after_id = int(request.GET.get('after_id', 0))
    except (ValueError, TypeError):
        after_id = 0

    new_articles = _get_filtered_queryset(request).filter(id__gt=after_id).order_by('-id')[:50]

    today = timezone.now().date()
    today_qs = Article.objects.filter(collected_at__date=today)

    return JsonResponse({
        'articles': [
            {
                'id': a.id,
                'suitability': a.suitability,
                'region': a.region,
                'title': a.title,
                'case_category': a.case_category,
                'defendant': a.defendant,
                'stage': a.stage,
                'press': a.press,
                'published_at': a.published_at.strftime('%Y-%m-%d %H:%M'),
            }
            for a in new_articles
        ],
        'total_today': today_qs.count(),
        'high_today': today_qs.filter(suitability='High').count(),
        'medium_today': today_qs.filter(suitability='Medium').count(),
    })
