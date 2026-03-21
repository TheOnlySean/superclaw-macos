(function () {
  const $ = (id) => document.getElementById(id);
  const checkOut = $("check-out");
  const installOut = $("install-out");

  $("btn-check").addEventListener("click", async () => {
    const btn = $("btn-check");
    btn.disabled = true;
    checkOut.textContent = "チェック中…";
    try {
      const result = await window.superclaw.systemCheck();
      checkOut.textContent = JSON.stringify(result, null, 2);
    } catch (e) {
      checkOut.textContent = "エラー: " + (e && e.message ? e.message : String(e));
    } finally {
      btn.disabled = false;
    }
  });

  let unsub = null;
  $("btn-install").addEventListener("click", async () => {
    const btn = $("btn-install");
    btn.disabled = true;
    installOut.textContent = "";
    if (unsub) unsub();
    unsub = window.superclaw.onInstallLog((data) => {
      installOut.textContent += (data && data.text) || "";
    });
    try {
      const res = await window.superclaw.startInstall();
      installOut.textContent += "\n\nRESULT: " + JSON.stringify(res);
    } catch (e) {
      installOut.textContent += "\n\nERROR: " + (e && e.message ? e.message : String(e));
    } finally {
      if (unsub) unsub();
      btn.disabled = false;
    }
  });

  $("btn-dashboard").addEventListener("click", async () => {
    try {
      await window.superclaw.openDashboard();
    } catch (e) {
      alert("ダッシュボード起動エラー: " + (e && e.message ? e.message : String(e)));
    }
  });

  $("btn-open-license").addEventListener("click", () => {
    window.superclaw.openExternal("https://www.superclaw.jp/purchase.html");
  });
})();
