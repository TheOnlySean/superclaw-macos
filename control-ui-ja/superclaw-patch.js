/* SuperClaw: 毛玻璃 + スキルマーケットボタン（Shadow DOM 内に注入） */
(function() {
  var styleId = 'superclaw-dashboard-styles';
  var modalId = 'superclaw-skill-market-modal';
  var btnClass = 'superclaw-skill-market-btn';
  var markerAttr = 'data-superclaw-skill-market-btn';
  var titleTexts = ['Skills', 'スキル', '技能', 'Fähigkeiten', 'Habilidades'];
  var fullCss = '.nav-group__items .nav-item{padding:.5rem .75rem!important;border-radius:6px!important}.nav-group__items .nav-item:hover{background:rgba(255,255,255,.06)!important}.nav-group__items .nav-item.active{background:rgba(255,255,255,.1)!important}.nav-label{padding:.4rem .75rem!important;border-radius:6px!important}.nav-group+.nav-group{margin-top:.5rem!important}input[type=text],input[type=search],input:not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]),textarea{border:1px solid rgba(0,0,0,.12)!important;border-radius:8px!important;background:rgba(255,255,255,.9)!important;box-shadow:0 1px 0 rgba(255,255,255,.8) inset!important}input:focus,textarea:focus{border-color:rgba(229,77,77,.5)!important;box-shadow:0 0 0 2px rgba(229,77,77,.15)!important;outline:none!important}[class*=sidebar],[class*=nav-bar],aside[class*=nav],.nav-root{background:rgba(255,255,255,.75)!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;border-right:1px solid rgba(0,0,0,.06)!important}.chat-compose,[class*=chat-compose]{background:rgba(255,255,255,.7)!important;backdrop-filter:blur(10px)!important;-webkit-backdrop-filter:blur(10px)!important;border-top:1px solid rgba(0,0,0,.06)!important}.card:not(.exec-approval-card),[class*=panel]{background:rgba(255,255,255,.8)!important;backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;border:1px solid rgba(0,0,0,.06)!important;border-radius:10px!important;box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 2px 12px rgba(0,0,0,.04)!important}[data-theme=light] .main,.light .main{background:rgba(248,249,252,.6)!important;backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important}.superclaw-skill-market-btn{display:inline-flex!important;align-items:center!important;gap:8px!important;padding:10px 20px!important;margin-bottom:16px!important;background:linear-gradient(135deg,#e54d4d 0%,#c73e3e 100%)!important;color:#fff!important;border:none!important;border-radius:10px!important;font-weight:600!important;font-size:15px!important;cursor:pointer!important;box-shadow:0 2px 8px rgba(229,77,77,.35)!important;transition:transform .15s ease,box-shadow .15s ease!important}.superclaw-skill-market-btn:hover{transform:translateY(-1px)!important;box-shadow:0 4px 12px rgba(229,77,77,.4)!important}#superclaw-skill-market-modal{position:fixed!important;inset:0!important;z-index:99999!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,.4)!important;backdrop-filter:blur(4px)!important}#superclaw-skill-market-modal .modal-inner{background:#fff!important;border-radius:14px!important;padding:28px 32px!important;max-width:380px!important;box-shadow:0 12px 40px rgba(0,0,0,.15)!important;text-align:center!important}#superclaw-skill-market-modal .modal-title{font-size:18px!important;font-weight:700!important;margin-bottom:12px!important;color:#1e293b!important}#superclaw-skill-market-modal .modal-body{font-size:15px!important;line-height:1.5!important;color:#475569!important;margin-bottom:24px!important}#superclaw-skill-market-modal .modal-close{padding:10px 24px!important;background:#e54d4d!important;color:#fff!important;border:none!important;border-radius:8px!important;font-weight:600!important;cursor:pointer!important}';

  function getRoot() {
    var app = document.querySelector('openclaw-app') || document.body.firstElementChild;
    if (!app) return null;
    if (app.shadowRoot) return app.shadowRoot;
    return null;
  }
  function isSkillsCardTitle(el) {
    if (!el || !el.classList || !el.classList.contains('card-title')) return false;
    var t = (el.textContent || '').trim();
    for (var i = 0; i < titleTexts.length; i++) if (t === titleTexts[i]) return true;
    return false;
  }
  function ensureModal(root) {
    if (!root) return null;
    var m = root.querySelector ? root.querySelector('#' + modalId) : null;
    if (m) return m;
    m = document.createElement('div');
    m.id = modalId;
    m.style.display = 'none';
    m.innerHTML = '<div class="modal-inner"><div class="modal-title">Coming soon</div><div class="modal-body">スキルマーケットを準備中です。まもなくお届けします。</div><button class="modal-close">OK</button></div>';
    m.addEventListener('click', function(e) {
      if (e.target === m || (e.target.classList && e.target.classList.contains('modal-close'))) m.style.display = 'none';
    });
    root.appendChild(m);
    return m;
  }
  function tryInject(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.card').forEach(function(card) {
      if (card.getAttribute(markerAttr)) return;
      var title = card.querySelector('.card-title');
      if (!title || !isSkillsCardTitle(title)) return;
      if (card.closest && card.closest('.card') && card.closest('.card') !== card) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnClass;
      btn.setAttribute(markerAttr, '1');
      btn.textContent = 'スキルマーケット';
      btn.addEventListener('click', function() {
        var m = ensureModal(root);
        if (m) m.style.display = 'flex';
      });
      var sub = card.querySelector('.card-sub');
      if (sub && sub.nextSibling) card.insertBefore(btn, sub.nextSibling);
      else if (sub) sub.parentNode.insertBefore(btn, sub.nextSibling);
      else card.insertBefore(btn, card.firstChild);
    });
  }
  function run(root) {
    if (!root) return;
    if (!root.querySelector || !root.querySelector('#' + styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = fullCss;
      root.appendChild(style);
    }
    tryInject(root);
  }
  function attach() {
    var root = getRoot();
    if (root) {
      run(root);
      try {
        var obs = new MutationObserver(function() { tryInject(root); });
        obs.observe(root, { childList: true, subtree: true });
      } catch (e) {}
      return true;
    }
    return false;
  }
  function scheduleAttach() {
    setTimeout(attach, 0);
    setTimeout(attach, 150);
    setTimeout(attach, 500);
  }
  if (typeof customElements !== 'undefined' && customElements.whenDefined) {
    customElements.whenDefined('openclaw-app').then(scheduleAttach).catch(scheduleAttach);
  } else {
    scheduleAttach();
  }
  var tries = 0;
  var iv = setInterval(function() {
    if (attach() || ++tries > 150) clearInterval(iv);
  }, 200);
  setTimeout(attach, 800);
  setTimeout(attach, 2500);
  setTimeout(attach, 5000);
})();
