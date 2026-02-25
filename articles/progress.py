"""분석 진행상황을 thread-safe하게 관리하는 모듈."""

import threading
from datetime import datetime, timedelta

_lock = threading.Lock()

_progress = {
    'is_running': False,
    'phase': '',          # 'collecting' | 'analyzing' | 'done'
    'current': 0,
    'total': 0,
    'started_at': None,   # ISO format string
    'estimated_end': None, # ISO format string
    'current_title': '',
    'saved': 0,
    'skipped_duplicate': 0,
    'failed': 0,
}


def get_progress() -> dict:
    """현재 진행상황 스냅샷 반환."""
    with _lock:
        return dict(_progress)


def start_collection():
    """수집 단계 시작."""
    with _lock:
        _progress.update({
            'is_running': True,
            'phase': 'collecting',
            'current': 0,
            'total': 0,
            'started_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'estimated_end': None,
            'current_title': '',
            'saved': 0,
            'skipped_duplicate': 0,
            'failed': 0,
        })


def start_analysis(total: int):
    """분석 단계 시작. total = 분석할 기사 수."""
    with _lock:
        _progress.update({
            'phase': 'analyzing',
            'current': 0,
            'total': total,
        })


def update_progress(current: int, title: str = ''):
    """분석 진행률 업데이트 + 종료 예정 시간 자동 계산."""
    with _lock:
        _progress['current'] = current
        _progress['current_title'] = title

        # 종료 예정 시간 계산 (최소 2건 처리 후부터)
        if current >= 2 and _progress['total'] > 0 and _progress['started_at']:
            started = datetime.strptime(_progress['started_at'], '%Y-%m-%d %H:%M:%S')
            elapsed = (datetime.now() - started).total_seconds()
            if current > 0:
                per_article = elapsed / current
                remaining = _progress['total'] - current
                est_end = datetime.now() + timedelta(seconds=per_article * remaining)
                _progress['estimated_end'] = est_end.strftime('%Y-%m-%d %H:%M:%S')


def update_result(saved: int = 0, skipped_duplicate: int = 0, failed: int = 0):
    """처리 결과 카운트 업데이트."""
    with _lock:
        _progress['saved'] = saved
        _progress['skipped_duplicate'] = skipped_duplicate
        _progress['failed'] = failed


def finish():
    """작업 완료 표시."""
    with _lock:
        _progress.update({
            'is_running': False,
            'phase': 'done',
            'estimated_end': None,
        })
