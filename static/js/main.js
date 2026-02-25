// Legal Radar - 실시간 분석 진행상황 폴링 + 필터 상태 복원

(function () {
    // === 필터 상태 복원 (URL 파라미터에서) ===
    const params = new URLSearchParams(window.location.search);
    ['suitability', 'case_category', 'stage', 'region'].forEach(function (name) {
        const val = params.get(name);
        if (val) {
            const sel = document.getElementById(name);
            if (sel) sel.value = val;
        }
    });
    ['date_from', 'date_to'].forEach(function (name) {
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
    };

    function formatTime(dtStr) {
        if (!dtStr) return '-';
        // "2026-02-25 11:03:16" → "11:03:16"
        var parts = dtStr.split(' ');
        return parts.length === 2 ? parts[1] : dtStr;
    }

    function updateUI(data) {
        // 분석이 실행 중이 아니고 done도 아니면 숨김
        if (!data.is_running && data.phase !== 'done') {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';

        // 완료 상태
        if (data.phase === 'done') {
            els.phase.textContent = '✅ 분석 완료';
            panel.classList.add('progress-done');
            panel.classList.remove('progress-collecting', 'progress-analyzing');
            els.bar.style.width = '100%';
            els.count.textContent = '';
            els.title.textContent = '';
            els.end.textContent = '완료';

            // 5초 후 페이지 새로고침
            if (wasRunning) {
                setTimeout(function () { location.reload(); }, 5000);
            }
            return;
        }

        panel.classList.remove('progress-done');
        wasRunning = true;

        // 수집 단계
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

        // 결과 카운트
        els.saved.textContent = data.saved || 0;
        els.dup.textContent = data.skipped_duplicate || 0;
        els.fail.textContent = data.failed || 0;
    }

    async function poll() {
        try {
            var res = await fetch('/api/progress/');
            if (res.ok) {
                var data = await res.json();
                updateUI(data);
            }
        } catch (e) {
            // 네트워크 오류 무시
        }
    }

    // 즉시 1회 + 주기적 폴링
    poll();
    setInterval(poll, POLL_INTERVAL);
})();
