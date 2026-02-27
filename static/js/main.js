// Legal Radar - 실시간 분석 진행상황 폴링 + 필터 상태 복원

// 뒤로가기 시 bfcache 복원 대신 최신 데이터 표시 (Safari 대응)
window.addEventListener('pageshow', function (event) {
    if (event.persisted) location.reload();
});

// === 심사 토글 ===
function getCsrfToken() {
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
        var c = cookies[i].trim();
        if (c.startsWith('csrftoken=')) return c.substring('csrftoken='.length);
    }
    return '';
}

async function handleReviewClick(btn, action, value) {
    var cell = btn.closest('.review-cell');
    if (!cell) return;
    var articleId = cell.dataset.articleId;

    var body = { action: action };
    if (action === 'passed') {
        var current = cell.dataset.reviewPassed;
        var target = String(value);
        body.value = (current === target) ? null : value;
    }

    try {
        var res = await fetch('/api/articles/' + articleId + '/review/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) return;
        var data = await res.json();
        document.querySelectorAll('.review-cell[data-article-id="' + articleId + '"]').forEach(function (c) {
            updateReviewCell(c, data);
        });
    } catch (e) { }
}

function updateReviewCell(cell, data) {
    cell.dataset.isReviewed = data.is_reviewed ? 'true' : 'false';
    cell.dataset.reviewPassed = data.review_passed === null ? 'null' : String(data.review_passed);

    var reviewedBtn = cell.querySelector('.btn-reviewed');
    if (reviewedBtn) {
        var isDetail = reviewedBtn.textContent.includes('완료') || !reviewedBtn.textContent.includes('심사');
        reviewedBtn.textContent = data.is_reviewed ? (isDetail ? '✓ 심사완료' : '✓ 심사') : '미심사';
        reviewedBtn.classList.toggle('active', data.is_reviewed);
    }

    var passBtn = cell.querySelector('.btn-pass');
    if (passBtn) passBtn.classList.toggle('active', data.review_passed === true);

    var failBtn = cell.querySelector('.btn-fail');
    if (failBtn) failBtn.classList.toggle('active', data.review_passed === false);
}

var SUITABILITY_CYCLE = ['High', 'Medium', 'Low'];

async function handleSuitabilityClick(badge) {
    var articleId = badge.dataset.articleId;
    var current = badge.dataset.suitability;
    var idx = SUITABILITY_CYCLE.indexOf(current);
    var next = SUITABILITY_CYCLE[(idx + 1) % SUITABILITY_CYCLE.length];

    try {
        var res = await fetch('/api/articles/' + articleId + '/suitability/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({ suitability: next }),
        });
        if (!res.ok) return;
        var data = await res.json();

        // 같은 기사의 모든 배지 업데이트 (목록 + 상세)
        document.querySelectorAll('.badge-suitability[data-article-id="' + articleId + '"]').forEach(function (b) {
            b.dataset.suitability = data.suitability;
            b.textContent = data.suitability;
            b.className = 'badge badge-' + data.suitability.toLowerCase() + ' badge-suitability badge-clickable';
            if (b.classList.contains('badge-lg')) b.classList.add('badge-lg');
        });

        // 요약 카드도 갱신
        fetchAndUpdateSummaryCards();
    } catch (e) { }
}

async function fetchAndUpdateSummaryCards() {
    try {
        var filterParams = new URLSearchParams(window.location.search);
        filterParams.set('after_id', '999999999');
        var res = await fetch('/api/articles/latest/?' + filterParams.toString());
        if (!res.ok) return;
        var data = await res.json();
        var totalEl = document.querySelector('.card-total .card-value');
        var highEl = document.querySelector('.card-high .card-value');
        var mediumEl = document.querySelector('.card-medium .card-value');
        if (totalEl) totalEl.textContent = data.total_today + '건';
        if (highEl) highEl.textContent = data.high_today + '건';
        if (mediumEl) mediumEl.textContent = data.medium_today + '건';
    } catch (e) { }
}


(function () {
    // === 필터 상태 복원 (URL 파라미터에서) ===
    const params = new URLSearchParams(window.location.search);
    ['suitability', 'case_category', 'stage', 'region', 'is_reviewed', 'review_passed'].forEach(function (name) {
        const val = params.get(name);
        if (val) {
            const sel = document.getElementById(name);
            if (sel) sel.value = val;
        }
    });
    ['title', 'date_from', 'date_to'].forEach(function (name) {
        const val = params.get(name);
        if (val) {
            const inp = document.getElementById(name);
            if (inp) inp.value = val;
        }
    });

    // === 실시간 진행상황 폴링 ===
    const POLL_INTERVAL = 3000; // 3초
    let wasRunning = false;

    const panel = document.getElementById('progressPanel');
    if (!panel) return;

    const els = {
        phase: document.getElementById('progressPhase'),
        count: document.getElementById('progressCount'),
        bar: document.getElementById('progressBar'),
        title: document.getElementById('progressTitle'),
        start: document.getElementById('progressStart'),
        end: document.getElementById('progressEnd'),
        saved: document.getElementById('statSaved'),
        dup: document.getElementById('statDup'),
        fail: document.getElementById('statFail'),
        stats: document.getElementById('progressStats'),
        lastFinished: document.getElementById('lastFinished'),
        prevFinished: document.getElementById('prevFinished'),
        nextScheduled: document.getElementById('nextScheduled'),
    };

    function formatTime(dtStr) {
        if (!dtStr) return '-';
        var parts = dtStr.split(' ');
        return parts.length === 2 ? parts[1] : dtStr;
    }

    function updateUI(data) {
        if (!data.is_running && data.phase !== 'done') {
            // 분석 중이 아니어도 시간 정보가 있으면 패널 표시
            if (data.last_finished_at) {
                panel.style.display = 'block';
                panel.classList.remove('progress-collecting', 'progress-analyzing');
                panel.classList.add('progress-done');
                els.phase.textContent = '✅ 대기 중';
                els.bar.style.width = '100%';
                els.count.textContent = '';
                els.title.textContent = '';
                els.end.textContent = '';
                els.start.textContent = '';
                els.stats.style.display = 'none';
                els.lastFinished.textContent = formatTime(data.last_finished_at);
                els.prevFinished.textContent = formatTime(data.previous_finished_at);
                els.nextScheduled.textContent = formatTime(data.next_scheduled_at);
            } else {
                panel.style.display = 'none';
            }
            return;
        }

        panel.style.display = 'block';

        if (data.phase === 'done') {
            els.phase.textContent = '✅ 분석 완료';
            panel.classList.add('progress-done');
            panel.classList.remove('progress-collecting', 'progress-analyzing');
            els.bar.style.width = '100%';
            els.count.textContent = '';
            els.title.textContent = '';
            els.end.textContent = '완료';
            els.lastFinished.textContent = formatTime(data.last_finished_at);
            els.prevFinished.textContent = formatTime(data.previous_finished_at);
            els.nextScheduled.textContent = formatTime(data.next_scheduled_at);

            if (wasRunning) {
                setTimeout(function () { location.reload(); }, 5000);
            }
            return;
        }

        panel.classList.remove('progress-done');
        wasRunning = true;

        if (data.phase === 'collecting') {
            els.phase.textContent = '📡 뉴스 수집 중...';
            panel.classList.add('progress-collecting');
            panel.classList.remove('progress-analyzing');
            els.bar.style.width = '0%';
            els.count.textContent = '';
            els.title.textContent = '네이버 뉴스 API에서 기사를 수집하고 있습니다...';
            els.start.textContent = formatTime(data.started_at);
            els.end.textContent = '수집 완료 후 계산';
            els.stats.style.display = 'none';
            els.lastFinished.textContent = formatTime(data.last_finished_at);
            els.prevFinished.textContent = formatTime(data.previous_finished_at);
            els.nextScheduled.textContent = '분석 중...';
            return;
        }

        // 분석 단계
        panel.classList.add('progress-analyzing');
        panel.classList.remove('progress-collecting');
        els.phase.textContent = '🔍 Gemini 분석 중...';
        els.stats.style.display = 'flex';

        var pct = data.total > 0
            ? Math.round((data.current / data.total) * 100)
            : 0;

        els.bar.style.width = pct + '%';
        els.count.textContent = data.current + ' / ' + data.total + '건 (' + pct + '%)';
        els.title.textContent = data.current_title || '';
        els.start.textContent = formatTime(data.started_at);
        els.end.textContent = data.estimated_end
            ? formatTime(data.estimated_end)
            : '계산 중...';

        els.saved.textContent = data.saved || 0;
        els.dup.textContent = data.skipped_duplicate || 0;
        els.fail.textContent = data.failed || 0;
        els.lastFinished.textContent = formatTime(data.last_finished_at);
        els.prevFinished.textContent = formatTime(data.previous_finished_at);
        els.nextScheduled.textContent = '분석 중...';
    }

    // === 실시간 기사 목록 + 요약 카드 업데이트 ===
    var maxArticleId = 0;

    // 현재 페이지 테이블에서 최대 article ID 초기화
    document.querySelectorAll('tbody tr[data-id]').forEach(function (row) {
        var id = parseInt(row.getAttribute('data-id')) || 0;
        if (id > maxArticleId) maxArticleId = id;
    });

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text)));
        return div.innerHTML;
    }

    function makeRow(article) {
        var tr = document.createElement('tr');
        tr.setAttribute('data-id', article.id);
        tr.innerHTML =
            '<td><span class="badge badge-' + article.suitability.toLowerCase() + ' badge-suitability badge-clickable" data-article-id="' + article.id + '" data-suitability="' + escapeHtml(article.suitability) + '" onclick="handleSuitabilityClick(this)">' + escapeHtml(article.suitability) + '</span></td>' +
            '<td><span class="badge badge-region-' + escapeHtml(article.region) + '">' + escapeHtml(article.region) + '</span></td>' +
            '<td><a href="/articles/' + article.id + '/" class="article-link">' + escapeHtml(article.title) + '</a></td>' +
            '<td>' + escapeHtml(article.case_category) + '</td>' +
            '<td>' + escapeHtml(article.defendant) + '</td>' +
            '<td>' + escapeHtml(article.stage) + '</td>' +
            '<td>' + escapeHtml(article.press) + '</td>' +
            '<td>' + escapeHtml(article.published_at) + '</td>' +
            '<td>' +
            '<div class="review-cell" data-article-id="' + article.id + '" data-is-reviewed="false" data-review-passed="null">' +
            '<button class="btn-reviewed" onclick="handleReviewClick(this, \'reviewed\')">미심사</button>' +
            '</div></td>' +
            '<td>' +
            '<div class="review-cell" data-article-id="' + article.id + '" data-is-reviewed="false" data-review-passed="null">' +
            '<button class="btn-pass" onclick="handleReviewClick(this, \'passed\', true)">통과</button>' +
            '<button class="btn-fail" onclick="handleReviewClick(this, \'passed\', false)">미통과</button>' +
            '</div></td>';
        return tr;
    }

    function updateSummaryCards(data) {
        var totalEl = document.querySelector('.card-total .card-value');
        var highEl = document.querySelector('.card-high .card-value');
        var mediumEl = document.querySelector('.card-medium .card-value');
        if (totalEl) totalEl.textContent = data.total_today + '건';
        if (highEl) highEl.textContent = data.high_today + '건';
        if (mediumEl) mediumEl.textContent = data.medium_today + '건';
    }

    async function pollArticles() {
        try {
            // 현재 URL의 필터 파라미터를 그대로 전달
            var filterParams = new URLSearchParams(window.location.search);
            filterParams.set('after_id', maxArticleId);
            var res = await fetch('/api/articles/latest/?' + filterParams.toString());
            if (!res.ok) return;
            var data = await res.json();

            if (data.articles && data.articles.length > 0) {
                var tbody = document.querySelector('tbody');

                // 빈 메시지 행 제거
                var emptyRow = tbody.querySelector('.empty-message');
                if (emptyRow) emptyRow.closest('tr').remove();

                // ID 내림차순 정렬 후 테이블 상단에 추가
                data.articles.sort(function (a, b) { return b.id - a.id; });
                data.articles.forEach(function (article) {
                    if (article.id > maxArticleId) maxArticleId = article.id;
                    tbody.insertBefore(makeRow(article), tbody.firstChild);
                });
            }

            updateSummaryCards(data);
        } catch (e) {
            // 네트워크 오류 무시
        }
    }

    async function poll() {
        try {
            var res = await fetch('/api/progress/');
            if (res.ok) {
                var data = await res.json();
                updateUI(data);

                // 수집 중일 때만 기사 목록 + 요약 카드 업데이트
                if (data.is_running) {
                    await pollArticles();
                }
            }
        } catch (e) {
            // 네트워크 오류 무시
        }
    }

    // 즉시 1회 + 주기적 폴링
    poll();
    setInterval(poll, POLL_INTERVAL);
})();
