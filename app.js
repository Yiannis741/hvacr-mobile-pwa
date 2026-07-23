function $(id) { return document.getElementById(id); }

function hvShowScreen(id) {
  ["screen-signin", "screen-folder", "screen-main"].forEach((s) => {
    $(s).hidden = s !== id;
  });
}

window.onHvAuthSuccess = function (token) {
  $("signin-status").textContent = "";
  const folderId = localStorage.getItem("hv_folder_id");
  const folderName = localStorage.getItem("hv_folder_name");
  if (folderId) {
    $("info-folder-name").textContent = folderName || folderId;
    hvShowScreen("screen-main");
    hvRefreshData();
  } else {
    hvShowScreen("screen-folder");
  }
};

async function hvRefreshData() {
  const token = hvGetValidToken();
  const status = $("main-status");
  const folderId = localStorage.getItem("hv_folder_id");
  if (!token || !folderId) return;
  status.textContent = "Ανανέωση…";
  status.className = "status";
  try {
    const folders = await hvGetSyncFolders(token, folderId);
    if (!folders.snapshot) {
      throw new Error("Δεν βρέθηκαν ακόμα οι υποφάκελοι συγχρονισμού — τρέξε \"Συγχρονισμός Τώρα\" στον υπολογιστή πρώτα.");
    }
    const snapshot = await hvReadSnapshot(token, folders.snapshot);
    $("info-generated-at").textContent = snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString("el-GR") : "—";
    $("info-units-count").textContent = (snapshot.units || []).length;
    $("info-tasks-count").textContent = (snapshot.tasks || []).length;
    window.hvSnapshot = snapshot;
    window.hvOutboxId = folders.outbox;
    status.textContent = "✓ Ενημερώθηκε.";
    status.className = "status ok";
  } catch (err) {
    status.textContent = "Σφάλμα: " + err.message;
    status.className = "status error";
  }
}

$("btn-signin").onclick = () => {
  $("signin-status").textContent = "Μεταφορά στη σύνδεση Google…";
  $("signin-status").className = "status";
  hvSignIn();
};

$("btn-pick-folder").onclick = () => {
  const token = hvGetValidToken();
  if (!token) return;
  $("folder-status").textContent = "";
  hvOpenFolderPicker(token, (id, name) => {
    localStorage.setItem("hv_folder_id", id);
    localStorage.setItem("hv_folder_name", name);
    $("info-folder-name").textContent = name;
    hvShowScreen("screen-main");
    hvRefreshData();
  });
};

$("btn-change-folder").onclick = () => {
  localStorage.removeItem("hv_folder_id");
  localStorage.removeItem("hv_folder_name");
  hvShowScreen("screen-folder");
};

$("btn-signout").onclick = () => {
  hvSignOut();
  hvShowScreen("screen-signin");
};

$("btn-refresh").onclick = hvRefreshData;

(function hvBoot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const fromRedirect = hvConsumeAuthRedirect();
  const existing = fromRedirect || hvGetValidToken();
  if (existing) {
    window.onHvAuthSuccess(existing);
  } else {
    if (window.hvLastAuthError) {
      $("signin-status").textContent = "Αποτυχία σύνδεσης: " + window.hvLastAuthError;
      $("signin-status").className = "status error";
    }
    hvShowScreen("screen-signin");
  }
})();
