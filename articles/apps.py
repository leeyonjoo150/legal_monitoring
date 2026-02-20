import os

from django.apps import AppConfig


class ArticlesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'articles'

    def ready(self):
        # runserver일 때만 스케줄러 시작 (migrate 등에서는 실행 안 함)
        run_main = os.environ.get('RUN_MAIN')
        if run_main == 'true':
            from articles.scheduler import start_scheduler
            start_scheduler()
