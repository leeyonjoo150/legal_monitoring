from django.db import models


class Article(models.Model):
    # 수집 정보
    title = models.CharField(max_length=500)
    url = models.URLField(unique=True)
    description = models.TextField()
    press = models.CharField(max_length=100)
    published_at = models.DateTimeField(db_index=True)
    collected_at = models.DateTimeField(auto_now_add=True)

    # 분석 결과
    ai_suitability = models.CharField(
        max_length=10,
        choices=[('High', 'High'), ('Medium', 'Medium'), ('Low', 'Low')],
        default='',
    )
    suitability = models.CharField(
        max_length=10,
        choices=[('High', 'High'), ('Medium', 'Medium'), ('Low', 'Low')],
        db_index=True,
    )
    suitability_reason = models.TextField()
    case_category = models.CharField(max_length=100, db_index=True)
    defendant = models.CharField(max_length=200)
    damage_scale = models.TextField()
    stage = models.CharField(max_length=50, db_index=True)
    stage_detail = models.CharField(max_length=200)
    summary = models.TextField()
    region = models.CharField(
        max_length=10,
        choices=[('국내', '국내'), ('해외', '해외')],
        default='국내',
        db_index=True,
    )
    is_reviewed = models.BooleanField(default=False)
    review_passed = models.BooleanField(null=True, default=None)

    class Meta:
        ordering = ['-published_at']

    def __str__(self):
        return f'[{self.suitability}] {self.title}'


class ArticleMemo(models.Model):
    article = models.ForeignKey(
        'Article',
        on_delete=models.CASCADE,
        related_name='memos',
    )
    author = models.CharField(max_length=50)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.author}: {self.content[:30]}'


class SkippedURL(models.Model):
    url = models.URLField(unique=True)
    title = models.CharField(max_length=500, default='')
    press = models.CharField(max_length=100, default='')
    skipped_at = models.DateTimeField(auto_now_add=True)
    related_article = models.ForeignKey(
        'Article',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='duplicate_articles'
    )

    def __str__(self):
        return self.url
