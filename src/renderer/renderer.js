(function () {
  const steps = ['welcome', 'check', 'risk', 'install', 'model', 'done', 'license'];
  let installLogUnsubscribe = null;

  function showStep(id) {
    steps.forEach((s) => {
      const el = document.getElementById('step-' + s);
      if (el) el.classList.toggle('active', s === id);
    });
  }

  function get(id) {
    return document.getElementById(id);
  }

  // --- Welcome（まずはシステムチェックのみ。既存ユーザー用のショートカットはチェック結果後に表示）
  get('btn-check').addEventListener('click', () => showStep('check'));

  // --- System check（チェック後：既に OpenClaw があれば「ダッシュボードを開く」、なければ「インストールする」）
  get('btn-check-go-dashboard').addEventListener('click', () => showStep('done'));

  get('btn-run-check').addEventListener('click', async () => {
    const btn = get('btn-run-check');
    btn.disabled = true;
    btn.textContent = 'チェック中…';
    try {
      const result = await window.superclaw.systemCheck();
      const { hasExistingConfig } = await window.superclaw.hasExistingOpenClawConfig();

      const wrap = get('check-result');
      wrap.style.display = 'block';

      const grid = get('check-grid');
      grid.innerHTML = '';
      const expectedClientName = result.os.expectedClient === 'darwin' ? 'macOS' : result.os.expectedClient === 'win32' ? 'Windows' : '';
      const items = [
        {
          label: 'Node.js',
          value: result.node.ok ? `Node ${result.node.version} ✓` : `Node ${result.node.required} 以上が必要です`,
          ok: result.node.ok,
        },
        result.npm ? {
          label: 'npm',
          value: result.npm.available ? `npm ${result.npm.version} ✓` : 'npm が使えません（Node と一緒にインストールされます）',
          ok: result.npm.available,
        } : null,
        {
          label: 'メモリ',
          value: result.ram.ok ? `${result.ram.totalGB} GB ✓` : `${result.ram.totalGB} GB（4GB以上必要、${result.ram.recommendedGB}GB以上推奨）`,
          ok: result.ram.ok,
        },
        {
          label: '空きディスク',
          value: result.disk.ok ? `${result.disk.freeGB} GB ✓` : `${result.disk.freeGB} GB（10GB以上必要）`,
          ok: result.disk.ok,
        },
        {
          label: 'OS',
          value: result.os.supported ? `${result.os.name} ✓` : `${result.os.name}（このアプリは ${expectedClientName} 用です）`,
          ok: result.os.supported,
        },
      ].filter(Boolean);
      items.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'check-item ' + (item.ok ? 'ok' : 'ng');
        const valueContent = item.valueHtml !== undefined ? item.valueHtml : item.value;
        div.innerHTML = `<div class="label">${item.label}</div><div class="value">${valueContent}</div>`;
        grid.appendChild(div);
      });

      const scoreWrap = get('score-wrap');
      scoreWrap.innerHTML = `
        <div class="score">${result.totalScore} / ${result.maxScore}</div>
        <div class="${result.pass ? 'pass' : 'fail'}">${result.pass ? 'OK、いける！' : 'ちょっと足りないかも'}</div>
      `;

      const btnInstall = get('btn-to-install');
      const btnCheckGoDashboard = get('btn-check-go-dashboard');
      const checkAlreadyMsg = get('check-already-msg');

      const nodeInstallBlock = get('node-install-block');
      const nodeInstallWrap = get('node-install-wrap');
      if (result.node && !result.node.ok) {
        nodeInstallBlock.style.display = 'block';
        nodeInstallWrap.style.display = 'none';
      } else {
        nodeInstallBlock.style.display = 'none';
        nodeInstallWrap.style.display = 'none';
      }

      if (result.pass && hasExistingConfig) {
        checkAlreadyMsg.style.display = 'block';
        btnCheckGoDashboard.style.display = 'inline-block';
        btnInstall.style.display = 'none';
      } else if (result.pass) {
        checkAlreadyMsg.style.display = 'none';
        btnCheckGoDashboard.style.display = 'none';
        btnInstall.style.display = 'inline-block';
      } else {
        checkAlreadyMsg.style.display = 'none';
        btnCheckGoDashboard.style.display = 'none';
        btnInstall.style.display = 'none';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'チェックを実行する';
    }
  });

  // --- Node をここでインストール（Node が足りないとき表示）
  let nodeInstallLogUnsubscribe = null;
  get('btn-install-node').addEventListener('click', async () => {
    const wrap = get('node-install-wrap');
    const logEl = get('node-install-log');
    const statusEl = get('node-install-status');
    const btnRetry = get('btn-node-install-retry-check');
    const block = get('node-install-block');

    block.style.display = 'none';
    wrap.style.display = 'block';
    logEl.innerHTML = '';
    statusEl.textContent = '準備しています…';
    statusEl.style.color = 'var(--muted)';
    btnRetry.style.display = 'none';

    if (nodeInstallLogUnsubscribe) nodeInstallLogUnsubscribe();
    nodeInstallLogUnsubscribe = window.superclaw.onNodeInstallLog((data) => {
      if (data.type === 'progress') {
        statusEl.textContent = data.text || data.percent + '%';
      } else {
        const span = document.createElement('span');
        span.className = data.type === 'stderr' ? 'err' : 'out';
        span.textContent = data.text;
        logEl.appendChild(span);
        logEl.scrollTop = logEl.scrollHeight;
      }
    });

    const result = await window.superclaw.installNode();
    if (nodeInstallLogUnsubscribe) nodeInstallLogUnsubscribe();

    if (result.ok) {
      statusEl.textContent = '完了しました。下の「もう一度チェックする」を押してください。';
      statusEl.style.color = 'var(--green)';
    } else {
      statusEl.textContent = 'エラー: ' + (result.error || '');
      statusEl.style.color = 'var(--red)';
    }
    btnRetry.style.display = 'inline-block';
  });

  get('btn-node-install-retry-check').addEventListener('click', () => {
    get('node-install-wrap').style.display = 'none';
    get('btn-run-check').click();
  });

  // --- Install
  get('btn-start-install').addEventListener('click', async () => {
    const btn = get('btn-start-install');
    const logWrap = get('install-log-wrap');
    const logEl = get('install-log');
    const statusEl = get('install-status');

    btn.disabled = true;
    logWrap.style.display = 'block';
    logEl.innerHTML = '';
    statusEl.textContent = 'インストール中…';
    get('install-xcode-first').style.display = 'none';
    get('install-xcode-hint').style.display = 'none';

    if (installLogUnsubscribe) installLogUnsubscribe();
    installLogUnsubscribe = window.superclaw.onInstallLog((data) => {
      const span = document.createElement('span');
      span.className = data.type === 'stderr' ? 'err' : 'out';
      span.textContent = data.text;
      logEl.appendChild(span);
      logEl.scrollTop = logEl.scrollHeight;
    });

    const result = await window.superclaw.startInstall();
    if (installLogUnsubscribe) installLogUnsubscribe();

    if (result.ok) {
      statusEl.textContent = 'インストールが完了しました。';
      statusEl.style.color = 'var(--green)';
      get('install-next-actions').style.display = 'flex';
      get('install-xcode-hint').style.display = 'none';
      get('install-xcode-first').style.display = 'none';
    } else if (result.error === 'XCODE_CLT_REQUIRED') {
      statusEl.textContent = 'コマンドラインツールが必要です。下の案内に従ってください。';
      statusEl.style.color = 'var(--orange)';
      get('install-xcode-first').style.display = 'block';
      get('install-xcode-hint').style.display = 'none';
    } else {
      statusEl.textContent = 'エラー: ' + (result.error || '');
      statusEl.style.color = 'var(--red)';
      const needXcode = result.error && /xcode-select|developer tools/i.test(result.error);
      get('install-xcode-hint').style.display = needXcode ? 'block' : 'none';
      get('install-xcode-first').style.display = 'none';
    }
    btn.disabled = false;
  });

  get('btn-install-xcode-from-install').addEventListener('click', async () => {
    const r = await window.superclaw.installXcodeClt();
    if (r.error) alert(r.error);
  });

  get('btn-open-xcode-install-again').addEventListener('click', async () => {
    const r = await window.superclaw.installXcodeClt();
    if (r.error) alert(r.error);
  });

  get('btn-to-model').addEventListener('click', () => showStep('model'));

  // --- Model
  function showModelStatus(msg, isError) {
    const el = get('model-status');
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--green)';
  }

  document.querySelector('.btn-model-codex').addEventListener('click', async () => {
    const btn = document.querySelector('.btn-model-codex');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>ログイン中…';
    showModelStatus('ブラウザが開きます。ログインを完了してください。');
    const unsub = window.superclaw.onModelAuthLog((data) => {
      const t = (data.text || '').trim();
      if (t) showModelStatus(t.replace(/^Open:\s*/i, 'ブラウザを開いています: '));
    });
    try {
      const result = await window.superclaw.loginCodex();
      if (result.ok) {
        showModelStatus('Codex を設定しました');
        get('btn-to-done').style.display = 'inline-block';
      } else showModelStatus('エラー: ' + (result.error || ''), true);
    } catch (e) {
      showModelStatus('エラー: ' + e.message, true);
    } finally {
      unsub();
    }
    btn.disabled = false;
    btn.textContent = 'ログイン';
  });

  document.querySelector('.btn-model-qwen').addEventListener('click', async () => {
    const btn = document.querySelector('.btn-model-qwen');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>ログイン中…';
    showModelStatus('ブラウザでデバイスコードを入力してください。');
    const unsub = window.superclaw.onModelAuthLog((data) => {
      const t = (data.text || '').trim();
      if (t) showModelStatus(t.replace(/^Open:\s*/i, 'ブラウザを開いています: '));
    });
    try {
      const result = await window.superclaw.loginQwen();
      if (result.ok) {
        showModelStatus('Qwen を設定しました');
        get('btn-to-done').style.display = 'inline-block';
      } else showModelStatus('エラー: ' + (result.error || ''), true);
    } catch (e) {
      showModelStatus('エラー: ' + e.message, true);
    } finally {
      unsub();
    }
    btn.disabled = false;
    btn.textContent = 'ログイン';
  });

  get('btn-skip-model').addEventListener('click', () => {
    showModelStatus('あとで openclaw models auth login で設定できます。');
    get('btn-to-done').style.display = 'inline-block';
  });

  get('btn-to-done').addEventListener('click', async () => {
    const btn = get('btn-to-done');
    const onboardStatus = get('onboard-status');
    btn.disabled = true;
    onboardStatus.style.display = 'block';
    onboardStatus.style.color = 'var(--muted)';

    const { hasExistingConfig } = await window.superclaw.hasExistingOpenClawConfig();
    if (hasExistingConfig) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/bb10cbe1-eb61-49ac-a7a6-a688bfda1c50',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'renderer.js:btn-to-done',message:'skip onboard (hasExistingConfig)',data:{hasExistingConfig:true},hypothesisId:'H-E',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      onboardStatus.textContent = '設定はそのまま。下のボタンで SuperClaw を使い始められるよ。';
      onboardStatus.style.color = 'var(--green)';
      showStep('done');
      btn.disabled = false;
      return;
    }

    onboardStatus.textContent = 'ゲートウェイを起動しています… 少々お待ちください。';
    onboardStatus.style.color = 'var(--muted)';
    btn.innerHTML = '<span class="spinner"></span>設定中…';
    const ONBOARD_TIMEOUT_MS = 120000;
    const runWithTimeout = () => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('タイムアウト')), ONBOARD_TIMEOUT_MS);
      window.superclaw.runOnboard().then((r) => { clearTimeout(t); resolve(r); }).catch((e) => { clearTimeout(t); reject(e); });
    });
    try {
      const result = await runWithTimeout();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/bb10cbe1-eb61-49ac-a7a6-a688bfda1c50',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'renderer.js:btn-to-done',message:'runOnboard result',data:{ok:result.ok,error:result.error},hypothesisId:'H-E',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (result.ok) {
        onboardStatus.textContent = '初期設定が完了しました';
        onboardStatus.style.color = 'var(--green)';
        showStep('done');
      } else {
        onboardStatus.textContent = 'エラー: ' + (result.error || '');
        onboardStatus.style.color = 'var(--red)';
      }
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/bb10cbe1-eb61-49ac-a7a6-a688bfda1c50',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'renderer.js:btn-to-done',message:'runOnboard catch',data:{message:e.message},hypothesisId:'H-E',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const msg = e.message === 'タイムアウト' ? '初期設定がタイムアウトしました。もう一度お試しください。' : ('エラー: ' + e.message);
      onboardStatus.textContent = msg;
      onboardStatus.style.color = 'var(--red)';
    }
    btn.disabled = false;
    btn.textContent = '次へ進む';
  });

  get('btn-to-install').addEventListener('click', () => showStep('risk'));
  get('btn-to-install-from-risk').addEventListener('click', () => showStep('install'));
  get('btn-risk-back').addEventListener('click', () => showStep('check'));

  // --- Done（セットアップ完了 → ライセンス確認のうえでダッシュボードを開く）
  get('btn-open-dashboard').addEventListener('click', async () => {
    const btn = get('btn-open-dashboard');
    const origText = btn.textContent;
    btn.disabled = true;
    try {
      const hasLicense = await window.superclaw.hasValidLicense();
      if (hasLicense) {
        btn.innerHTML = '<span class="spinner"></span>開いています…';
        await window.superclaw.openDashboard();
      } else {
        showStep('license');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText || 'SuperClaw を使い始める';
    }
  });

  // --- License（ライセンス認証 → 認証後にダッシュボードを開く）
  get('btn-license-verify').addEventListener('click', async () => {
    const input = get('license-key-input');
    const errEl = get('license-error');
    const btn = get('btn-license-verify');
    const key = (input && input.value) ? input.value.trim() : '';
    errEl.style.display = 'none';
    errEl.textContent = '';
    if (!key) {
      errEl.textContent = 'ライセンスキーを入力してください。';
      errEl.style.display = 'block';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>認証中…';
    try {
      const result = await window.superclaw.verifyLicense(key);
      if (result.ok) {
        btn.innerHTML = '<span class="spinner"></span>開いています…';
        await window.superclaw.openDashboard();
        btn.textContent = '認証してダッシュボードを開く';
      } else {
        errEl.textContent = result.error || '認証に失敗しました。';
        errEl.style.display = 'block';
        btn.textContent = '認証してダッシュボードを開く';
      }
    } catch (e) {
      errEl.textContent = e.message || 'エラーが発生しました。';
      errEl.style.display = 'block';
      btn.textContent = '認証してダッシュボードを開く';
    }
    btn.disabled = false;
  });

  get('link-license-purchase').addEventListener('click', (e) => {
    e.preventDefault();
    const url = e.currentTarget && e.currentTarget.href ? e.currentTarget.href : 'https://www.superclaw.jp/purchase.html';
    if (window.superclaw && typeof window.superclaw.openExternal === 'function') {
      window.superclaw.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  });
})();
