from django.urls import path

from articles import views

app_name = 'articles'

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('articles/<int:article_id>/', views.detail, name='detail'),
    path('export/', views.export_xlsx, name='export'),
    path('api/progress/', views.progress_status, name='progress'),
    path('api/articles/latest/', views.api_articles_latest, name='articles_latest'),
    path('api/articles/<int:article_id>/review/', views.toggle_review, name='toggle_review'),
]
