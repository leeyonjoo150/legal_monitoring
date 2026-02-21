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

    class Meta:
        ordering = ['-published_at']

    def __str__(self):
        return f'[{self.suitability}] {self.title}'


class SkippedURL(models.Model):
    url = models.URLField(unique=True)
    skipped_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.url
