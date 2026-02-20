from django.contrib import admin

from articles.models import Article


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = [
        'suitability', 'title', 'case_category', 'defendant',
        'stage', 'press', 'published_at',
    ]
    list_filter = ['suitability', 'case_category', 'stage']
    search_fields = ['title', 'defendant', 'summary']
    list_per_page = 30
    ordering = ['-published_at']
