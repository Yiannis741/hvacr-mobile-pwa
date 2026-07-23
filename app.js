function $(id) { return document.getElementById(id); }

function hvShowScreen(id) {
  ["screen-signin", "screen-folder", "screen-main"].forEach((s) => {
    $(s).hidden = s !== id;
  });
}

function hvWaitFor(check, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Timeout φόρτωσης Google script."));
      setTimeout(poll, 100);
    })();
  });
}

let hvAuthReady = false;

async function hvEnsureAuthReady() {
  if (hvAuthReady) return;
  await hvWaitFor(() => window.google && google.accounts && google.accounts.oauth2, 10000);
  hvInitAuth();
  hvAuthReady = true;
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

window.onHvAuthError = function (err) {
  $("signin-status").textContent = "Αποτυχία σύνδεσης: " + err;
  $("signin-status").className = "status error";
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

$("btn-signin").onclick = async () => {
  $("btn-signin").disabled = true;
  $("signin-status").textContent = "Σύνδεση…";
  $("signin-status").className = "status";
  try {
    await hvEnsureAuthReady();
    hvSignIn(true);
  } catch (err) {
    window.onHvAuthError(err.message);
  } finally {
    $("btn-signin").disabled = false;
  }
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

// Αρχική κατάσταση: αν υπάρχει ήδη έγκυρο token από προηγούμενη επίσκεψη (ίδια συνεδρία),
// προχώρα κατευθείαν χωρίς να ζητηθεί ξανά σύνδεση.
(async function hvBoot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  try {
    await hvEnsureAuthReady();
  } catch (err) {
    // Google script άργησε να φορτώσει· ο χρήστης μπορεί ακόμα να πατήσει Σύνδεση αργότερα.
  }
  const existing = hvGetValidToken();
  if (existing) {
    window.onHvAuthSuccess(existing);
  } else {
    hvShowScreen("screen-signin");
  }
})();
