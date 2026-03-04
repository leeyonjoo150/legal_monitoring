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
    path('api/articles/<int:article_id>/suitability/', views.update_suitability, name='update_suitability'),
    path('api/charts/', views.api_charts, name='charts'),
    path('api/articles/<int:article_id>/memos/', views.add_memo, name='add_memo'),
    path('api/articles/pdf/', views.api_pdf_articles, name='pdf_articles'),
    path('api/articles/pdf/details/', views.api_pdf_article_details, name='pdf_article_details'),
]
