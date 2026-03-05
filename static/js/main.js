// Legal Radar - 실시간 분석 진행상황 폴링 + 필터 상태 복원

// 뒤로가기 시 bfcache 복원 대신 최신 데이터 표시 (Safari 대응)
window.addEventListener('pageshow', function (event) {
    if (event.persisted) location.reload();
});

// PDF 모드 플래그 (활성화 시 실시간 폴링 일시 정지)
window._pdfMode = false;

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

    // === 브라우저 알림 ===
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    function sendBrowserNotification(title, body) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        new Notification(title, { body: body });
    }

    // === 실시간 진행상황 폴링 ===
    const POLL_INTERVAL = 3000; // 3초
    let wasRunning = false;
    let isFirstPoll = true;
    const LAST_STARTED_KEY = 'lg_last_started_at';

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

    // PDF 모드에서 스냅샷 기준 ID로 사용
    window.getMaxArticleId = function () { return maxArticleId; };

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
        if (window._pdfMode) return;
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
                var prevRunning = wasRunning;
                updateUI(data);

                if (isFirstPoll) {
                    // 첫 폴링: 새로고침인지 새 수집인지 구분
                    if (data.is_running && data.started_at) {
                        var savedStartedAt = localStorage.getItem(LAST_STARTED_KEY);
                        if (savedStartedAt !== data.started_at) {
                            // started_at이 다르면 새 수집 → 알림
                            sendBrowserNotification('Law&Good', '기사 수집을 시작합니다.');
                            localStorage.setItem(LAST_STARTED_KEY, data.started_at);
                        }
                    }
                    isFirstPoll = false;
                } else {
                    // 이후 폴링: 상태 변화 감지
                    if (!prevRunning && data.is_running) {
                        // 수집 시작 알림
                        sendBrowserNotification('Law&Good', '기사 수집을 시작합니다.');
                        if (data.started_at) localStorage.setItem(LAST_STARTED_KEY, data.started_at);
                    }
                    if (prevRunning && data.phase === 'done') {
                        // 수집 완료 알림
                        sendBrowserNotification('Law&Good',
                            '수집 완료 — 저장 ' + (data.saved || 0) + '건 / 중복 ' + (data.skipped_duplicate || 0) + '건 / 실패 ' + (data.failed || 0) + '건');
                    }
                }

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


// === 메모 기능 ===
(function () {
    var AUTHOR_KEY = 'memo_author';

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text)));
        return div.innerHTML;
    }

    // 저장된 작성자명 복원
    var authorInput = document.getElementById('memoAuthor');
    if (authorInput) {
        var saved = localStorage.getItem(AUTHOR_KEY);
        if (saved) authorInput.value = saved;
    }

    window.submitMemo = async function (articleId) {
        var authorEl = document.getElementById('memoAuthor');
        var contentEl = document.getElementById('memoContent');
        if (!authorEl || !contentEl) return;

        var author = authorEl.value.trim();
        var content = contentEl.value.trim();

        if (!author) { alert('작성자를 입력해주세요.'); return; }
        if (!content) { alert('메모 내용을 입력해주세요.'); return; }

        localStorage.setItem(AUTHOR_KEY, author);

        try {
            var res = await fetch('/api/articles/' + articleId + '/memos/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ author: author, content: content }),
            });
            if (!res.ok) return;
            var data = await res.json();

            // 빈 메모 안내 제거
            var emptyEl = document.getElementById('memoEmpty');
            if (emptyEl) emptyEl.remove();

            // 새 메모를 목록 맨 위에 추가
            var list = document.getElementById('memoList');
            var li = document.createElement('li');
            li.className = 'memo-item memo-item-new';
            li.innerHTML =
                '<div class="memo-meta">' +
                '<span class="memo-author">' + escapeHtml(data.author) + '</span>' +
                '<span class="memo-date">' + escapeHtml(data.created_at) + '</span>' +
                '</div>' +
                '<p class="memo-content">' + escapeHtml(data.content) + '</p>';
            list.appendChild(li);

            // 내용만 초기화 (작성자는 유지)
            contentEl.value = '';
        } catch (e) { }
    };
})();


// === 차트 섹션 ===
(function () {
    var chartInstances = {};
    var DAYS_KEY = 'chart_days';
    var OPEN_PREFIX = 'chart_open_';

    function getStoredDays() {
        var v = parseInt(localStorage.getItem(DAYS_KEY), 10);
        return isNaN(v) || v < 1 ? 30 : v;
    }

    function isChartOpen(key) {
        var v = localStorage.getItem(OPEN_PREFIX + key);
        return v === null ? true : v === 'true';
    }

    window.toggleChart = function (key) {
        var capKey = key.charAt(0).toUpperCase() + key.slice(1);
        var body = document.getElementById('chart' + capKey + 'Body');
        var icon = document.getElementById('chart' + capKey + 'Icon');
        if (!body || !icon) return;
        var nextOpen = !isChartOpen(key);
        localStorage.setItem(OPEN_PREFIX + key, String(nextOpen));
        body.style.display = nextOpen ? 'block' : 'none';
        icon.textContent = nextOpen ? '▲' : '▼';
    };

    function applyInitStates() {
        ['stage', 'review', 'top10'].forEach(function (key) {
            var capKey = key.charAt(0).toUpperCase() + key.slice(1);
            var body = document.getElementById('chart' + capKey + 'Body');
            var icon = document.getElementById('chart' + capKey + 'Icon');
            if (!body || !icon) return;
            var open = isChartOpen(key);
            body.style.display = open ? 'block' : 'none';
            icon.textContent = open ? '▲' : '▼';
        });
    }

    function setEmpty(canvasId, emptyId, isEmpty) {
        var canvas = document.getElementById(canvasId);
        var empty = document.getElementById(emptyId);
        if (canvas) canvas.style.display = isEmpty ? 'none' : 'block';
        if (empty) empty.style.display = isEmpty ? 'block' : 'none';
    }

    function renderCharts(data) {
        Object.keys(chartInstances).forEach(function (k) { chartInstances[k].destroy(); });
        chartInstances = {};

        // 1. 진행 단계별 High (수평 바)
        var stageCounts = data.stage_high.counts;
        var stageHasData = stageCounts.some(function (v) { return v > 0; });
        setEmpty('chartStage', 'chartStageEmpty', !stageHasData);
        if (stageHasData) {
            var stageCtx = document.getElementById('chartStage').getContext('2d');
            chartInstances['stage'] = new Chart(stageCtx, {
                type: 'bar',
                data: {
                    labels: data.stage_high.labels,
                    datasets: [{
                        data: stageCounts,
                        backgroundColor: 'rgba(233,69,96,0.75)',
                        borderColor: '#e94560',
                        borderWidth: 1,
                        borderRadius: 4,
                    }],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { beginAtZero: true, ticks: { precision: 0 } },
                        y: { ticks: { font: { size: 12 } } },
                    },
                    onClick: function (e, elements) {
                        if (!elements.length) return;
                        var stage = data.stage_high.labels[elements[0].index];
                        window.location.href = '/?suitability=High&stage=' + encodeURIComponent(stage);
                    },
                    onHover: function (e, elements) {
                        e.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                    },
                },
            });
        }

        // 2. 심사 현황 (도넛)
        var reviewed = data.review_status.reviewed;
        var unreviewed = data.review_status.unreviewed;
        var reviewHasData = (reviewed + unreviewed) > 0;
        setEmpty('chartReview', 'chartReviewEmpty', !reviewHasData);
        if (reviewHasData) {
            var reviewCtx = document.getElementById('chartReview').getContext('2d');
            chartInstances['review'] = new Chart(reviewCtx, {
                type: 'doughnut',
                data: {
                    labels: ['심사완료', '미심사'],
                    datasets: [{
                        data: [reviewed, unreviewed],
                        backgroundColor: ['#10b981', '#e5e7eb'],
                        borderWidth: 0,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: { position: 'bottom', labels: { font: { size: 12 } } },
                    },
                    onClick: function (e, elements) {
                        if (!elements.length) return;
                        var idx = elements[0].index;
                        var isReviewed = idx === 0 ? 'true' : 'false';
                        window.location.href = '/?suitability=High%2BMedium&is_reviewed=' + isReviewed;
                    },
                    onHover: function (e, elements) {
                        e.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                    },
                },
            });
        }

        // 3. 중복 수 Top 10 (수평 바)
        var top10 = data.top10_duplicates;
        var top10HasData = top10.length > 0;
        setEmpty('chartTop10', 'chartTop10Empty', !top10HasData);
        var top10Body = document.getElementById('chartTop10Body');
        if (top10HasData && top10Body) {
            top10Body.style.height = Math.max(160, top10.length * 44 + 40) + 'px';
            var top10Ctx = document.getElementById('chartTop10').getContext('2d');
            var top10Labels = top10.map(function (d) {
                return d.title.length > 45 ? d.title.substring(0, 45) + '…' : d.title;
            });
            chartInstances['top10'] = new Chart(top10Ctx, {
                type: 'bar',
                data: {
                    labels: top10Labels,
                    datasets: [{
                        data: top10.map(function (d) { return d.count; }),
                        backgroundColor: 'rgba(245,158,11,0.75)',
                        borderColor: '#f59e0b',
                        borderWidth: 1,
                        borderRadius: 4,
                    }],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: function (items) {
                                    return top10[items[0].dataIndex].title;
                                },
                            },
                        },
                    },
                    scales: {
                        x: { beginAtZero: true, ticks: { precision: 0 } },
                        y: { ticks: { font: { size: 12 } } },
                    },
                    onClick: function (e, elements) {
                        if (!elements.length) return;
                        var id = top10[elements[0].index].id;
                        window.location.href = '/articles/' + id + '/';
                    },
                    onHover: function (e, elements) {
                        e.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                    },
                },
            });
        }
    }

    async function loadCharts(days) {
        try {
            var res = await fetch('/api/charts/?days=' + days);
            if (!res.ok) return;
            var data = await res.json();
            renderCharts(data);
        } catch (e) { }
    }

    var daysInput = document.getElementById('chartDays');
    if (!daysInput) return;

    var storedDays = getStoredDays();
    daysInput.value = storedDays;
    applyInitStates();
    loadCharts(storedDays);

    // PDF용 차트 이미지 캡처 (chartInstances가 있는 차트만 포함)
    window.captureChartImages = function () {
        var images = {};
        var keyMap = { stage: 'chartStage', review: 'chartReview', top10: 'chartTop10' };
        Object.keys(keyMap).forEach(function (key) {
            if (chartInstances[key]) {
                var canvas = document.getElementById(keyMap[key]);
                if (canvas) images[keyMap[key]] = canvas.toDataURL('image/png');
            }
        });
        return images;
    };

    var debounceTimer = null;
    daysInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            var d = parseInt(daysInput.value, 10);
            if (isNaN(d) || d < 1) d = 1;
            if (d > 365) d = 365;
            daysInput.value = d;
            localStorage.setItem(DAYS_KEY, String(d));
            loadCharts(d);
        }, 500);
    });
})();


// === PDF 내보내기 ===
(function () {
    var pdfMaxId = 0;
    var pdfArticles = [];

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text == null ? '' : text)));
        return div.innerHTML;
    }

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    window.openPdfModal = async function () {
        pdfMaxId = window.getMaxArticleId ? window.getMaxArticleId() : 0;
        window._pdfMode = true;

        var modal = document.getElementById('pdfModal');
        var listEl = document.getElementById('pdfArticleList');
        var loadingEl = document.getElementById('pdfModalLoading');
        var countEl = document.getElementById('pdfModalCount');
        var selectAllCb = document.getElementById('pdfSelectAll');
        if (!modal) return;

        if (selectAllCb) selectAllCb.checked = false;
        if (countEl) countEl.textContent = '';
        if (loadingEl) { loadingEl.textContent = '기사를 불러오는 중...'; loadingEl.style.display = 'block'; }
        if (listEl) listEl.style.display = 'none';
        modal.style.display = 'flex';

        try {
            var params = new URLSearchParams(window.location.search);
            if (pdfMaxId > 0) params.set('max_id', pdfMaxId);
            var res = await fetch('/api/articles/pdf/?' + params.toString());
            if (!res.ok) throw new Error('fetch failed');
            var data = await res.json();
            pdfArticles = data.articles;

            if (loadingEl) loadingEl.style.display = 'none';
            if (listEl) {
                listEl.innerHTML = '';
                if (pdfArticles.length === 0) {
                    listEl.innerHTML = '<li class="pdf-empty">선택 가능한 기사가 없습니다.</li>';
                } else {
                    pdfArticles.forEach(function (a) {
                        var li = document.createElement('li');
                        li.className = 'pdf-article-item';
                        li.innerHTML =
                            '<label>' +
                            '<input type="checkbox" class="pdf-checkbox" value="' + a.id + '"> ' +
                            '<span class="pdf-badge pdf-badge-' + escapeHtml(a.suitability.toLowerCase()) + '">' + escapeHtml(a.suitability) + '</span> ' +
                            '<span class="pdf-article-title">' + escapeHtml(a.title) + '</span>' +
                            '</label>';
                        listEl.appendChild(li);
                    });
                    if (countEl) countEl.textContent = '총 ' + pdfArticles.length + '건';
                }
                listEl.style.display = 'block';
            }
        } catch (e) {
            if (loadingEl) loadingEl.textContent = '로드 실패. 다시 시도해주세요.';
        }
    };

    window.closePdfModal = function () {
        var modal = document.getElementById('pdfModal');
        if (modal) modal.style.display = 'none';
        window._pdfMode = false;
    };

    window.selectAllPdf = function (checked) {
        document.querySelectorAll('.pdf-checkbox').forEach(function (cb) {
            cb.checked = checked;
        });
    };

    window.generatePdf = async function () {
        var selected = [];
        document.querySelectorAll('.pdf-checkbox:checked').forEach(function (cb) {
            selected.push(parseInt(cb.value));
        });

        var chartImages = window.captureChartImages ? window.captureChartImages() : {};
        var detailArticles = [];

        if (selected.length > 0) {
            try {
                var res = await fetch('/api/articles/pdf/details/?ids=' + selected.join(','));
                if (res.ok) {
                    var data = await res.json();
                    detailArticles = data.articles;
                }
            } catch (e) { }
        }

        buildPrintArea(chartImages, detailArticles, selected);

        var modal = document.getElementById('pdfModal');
        if (modal) modal.style.display = 'none';

        setTimeout(function () { window.print(); }, 300);
    };

    function buildPrintArea(chartImages, detailArticles, selectedIds) {
        var printArea = document.getElementById('printArea');
        if (!printArea) return;
        var selectedSet = {};
        (selectedIds || []).forEach(function (id) { selectedSet[id] = true; });

        var days = parseInt(localStorage.getItem('chart_days'), 10) || 30;
        var now = new Date();
        var fromDate = new Date(now.getTime() - days * 86400000);
        var dateRange = formatDate(fromDate) + ' ~ ' + formatDate(now);

        var html = '';

        // 헤더
        html += '<div class="print-header">';
        html += '<h1>Law&amp;Good - 소송금융 투자 검토 모니터링</h1>';
        html += '<p class="print-generated">생성일: ' + formatDate(now) + '</p>';
        html += '</div>';

        // 차트 섹션
        var chartKeys = ['chartStage', 'chartReview', 'chartTop10'];
        var chartTitles = {
            chartStage: '진행 단계별 High 기사',
            chartReview: '심사 현황 (High+Medium)',
            chartTop10: '중복 기사 수 Top 10',
        };
        var hasAnyChart = chartKeys.some(function (k) { return chartImages[k]; });
        if (hasAnyChart) {
            html += '<div class="print-section">';
            html += '<h2 class="print-section-title">분석 현황 <span class="print-period">(' + dateRange + ')</span></h2>';
            html += '<div class="print-charts-grid">';
            chartKeys.forEach(function (key) {
                if (chartImages[key]) {
                    var wideClass = (key === 'chartTop10') ? ' print-chart-wide' : '';
                    html += '<div class="print-chart-item' + wideClass + '">';
                    html += '<p class="print-chart-title">' + chartTitles[key] + '</p>';
                    html += '<img src="' + chartImages[key] + '" class="print-chart-img">';
                    html += '</div>';
                }
            });
            html += '</div></div>';
        }

        // 기사 목록
        html += '<div class="print-section">';
        html += '<h2 class="print-section-title">기사 목록 <span class="print-count">(' + pdfArticles.length + '건)</span></h2>';
        html += '<table class="print-table">';
        html += '<thead><tr><th>적합도</th><th>지역</th><th>제목</th><th>사건분야</th><th>상대방</th><th>단계</th><th>언론사</th><th>게재일</th></tr></thead>';
        html += '<tbody>';
        pdfArticles.forEach(function (a) {
            var isSelected = selectedSet[a.id];
            var titleHtml = isSelected
                ? '<span class="print-highlight">' + escapeHtml(a.title) + '</span>'
                : escapeHtml(a.title);
            html += '<tr>';
            html += '<td><span class="print-badge print-badge-' + escapeHtml(a.suitability.toLowerCase()) + '">' + escapeHtml(a.suitability) + '</span></td>';
            html += '<td>' + escapeHtml(a.region) + '</td>';
            html += '<td>' + titleHtml + '</td>';
            html += '<td>' + escapeHtml(a.case_category) + '</td>';
            html += '<td>' + escapeHtml(a.defendant) + '</td>';
            html += '<td>' + escapeHtml(a.stage) + '</td>';
            html += '<td>' + escapeHtml(a.press) + '</td>';
            html += '<td>' + escapeHtml(a.published_at) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        // 선택 기사 상세
        if (detailArticles.length > 0) {
            html += '<div class="print-section">';
            html += '<h2 class="print-section-title">선택 기사 상세 (' + detailArticles.length + '건)</h2>';
            detailArticles.forEach(function (a) {
                html += '<div class="print-detail-card">';
                html += '<div class="print-detail-header">';
                html += '<span class="print-badge print-badge-' + escapeHtml(a.suitability.toLowerCase()) + '">' + escapeHtml(a.suitability) + '</span>';
                if (a.ai_suitability && a.ai_suitability !== a.suitability) {
                    html += '<span class="print-ai-note">AI 원본: ' + escapeHtml(a.ai_suitability) + ' → 수정됨</span>';
                }
                html += '<h3 class="print-detail-title">' + escapeHtml(a.title) + '</h3>';
                html += '<p class="print-detail-meta">' + escapeHtml(a.press) + ' &middot; ' + escapeHtml(a.published_at) + ' &middot; ' + escapeHtml(a.region) + '</p>';
                html += '</div>';
                html += '<div class="print-detail-body">';
                html += '<p><strong>AI 요약</strong><br>' + escapeHtml(a.summary) + '</p>';
                html += '<div class="print-detail-grid">';
                html += '<div><strong>적합도 근거:</strong> ' + escapeHtml(a.suitability_reason) + '</div>';
                html += '<div><strong>사건 분야:</strong> ' + escapeHtml(a.case_category) + '</div>';
                html += '<div><strong>상대방:</strong> ' + escapeHtml(a.defendant) + '</div>';
                html += '<div><strong>피해 규모:</strong> ' + escapeHtml(a.damage_scale) + '</div>';
                html += '<div><strong>진행 단계:</strong> ' + escapeHtml(a.stage) + '</div>';
                html += '<div><strong>단계 상세:</strong> ' + escapeHtml(a.stage_detail) + '</div>';
                html += '</div>';
                if (a.memos && a.memos.length > 0) {
                    html += '<div class="print-memos">';
                    html += '<strong>메모</strong><ul>';
                    a.memos.forEach(function (m) {
                        html += '<li><strong>' + escapeHtml(m.author) + '</strong> (' + escapeHtml(m.created_at) + '): ' + escapeHtml(m.content) + '</li>';
                    });
                    html += '</ul></div>';
                }
                html += '</div></div>';
            });
            html += '</div>';
        }

        printArea.innerHTML = html;
    }

    // 인쇄 완료 후 정리
    window.addEventListener('afterprint', function () {
        var printArea = document.getElementById('printArea');
        if (printArea) printArea.innerHTML = '';
        window._pdfMode = false;
    });
})();
