function $(id) { return document.getElementById(id); }

const HV_SCREENS = ["screen-signin", "screen-folder", "screen-main", "screen-add-unit", "screen-add-attachment"];

function hvShowScreen(id) {
  HV_SCREENS.forEach((s) => {
    $(s).hidden = s !== id;
  });
}

function hvEscapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Τοπική ουρά "εκκρεμών" καταχωρήσεων (μόνο για ενημέρωση του τεχνικού) ---
// hv_pending_log: [{ts, kind:'unit'|'attachment', text, localId?}]
function hvLoadPendingLog() {
  try { return JSON.parse(localStorage.getItem("hv_pending_log") || "[]"); } catch (e) { return []; }
}
function hvSavePendingLog(log) {
  localStorage.setItem("hv_pending_log", JSON.stringify(log));
}
function hvAddPendingLog(entry) {
  const log = hvLoadPendingLog();
  log.unshift({ ts: new Date().toISOString(), ...entry });
  hvSavePendingLog(log);
  hvRenderPendingList();
}
function hvPendingUnits() {
  return hvLoadPendingLog().filter((e) => e.kind === "unit" && e.localId);
}
function hvRenderPendingList() {
  const log = hvLoadPendingLog();
  const card = $("pending-card");
  const list = $("pending-list");
  if (!log.length) {
    card.hidden = true;
    list.innerHTML = "";
    return;
  }
  card.hidden = false;
  list.innerHTML = log
    .map((e) => {
      const when = new Date(e.ts).toLocaleString("el-GR");
      return `<div class="pending-item"><div class="t">${hvEscapeHtml(e.text)}</div>${when}</div>`;
    })
    .join("");
}

window.onHvAuthSuccess = function (token) {
  $("signin-status").textContent = "";
  const folderId = localStorage.getItem("hv_folder_id");
  const folderName = localStorage.getItem("hv_folder_name");
  if (folderId) {
    $("info-folder-name").textContent = folderName || folderId;
    hvShowScreen("screen-main");
    hvRenderPendingList();
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
    hvRenderPendingList();
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

$("btn-clear-pending").onclick = () => {
  hvSavePendingLog([]);
  hvRenderPendingList();
};

// --- Προσθήκη μονάδας ---
function hvPopulateUnitForm() {
  const snap = window.hvSnapshot || {};
  const locSel = $("unit-location");
  const grpSel = $("unit-group");
  const locations = snap.locations || [];
  locSel.innerHTML =
    '<option value="">— Επίλεξε —</option>' +
    locations.map((l) => `<option value="${l.id}">${hvEscapeHtml(l.name)}</option>`).join("");
  function refreshGroups() {
    const locId = locSel.value;
    const groups = snap.groups || [];
    const pairs = snap.location_groups || [];
    const allowedIds = new Set(pairs.filter((p) => String(p.location_id) === String(locId)).map((p) => String(p.group_id)));
    const filtered = locId ? groups.filter((g) => allowedIds.has(String(g.id))) : [];
    grpSel.innerHTML =
      '<option value="">— Επίλεξε τοποθεσία πρώτα —</option>' +
      filtered.map((g) => `<option value="${g.id}">${hvEscapeHtml(g.name)}</option>`).join("");
  }
  locSel.onchange = refreshGroups;
  refreshGroups();
}

$("btn-add-unit").onclick = () => {
  $("unit-name").value = "";
  $("unit-model").value = "";
  $("unit-serial").value = "";
  $("unit-installation-date").value = "";
  $("unit-notes").value = "";
  $("add-unit-status").textContent = "";
  $("add-unit-status").className = "status";
  hvPopulateUnitForm();
  hvShowScreen("screen-add-unit");
};

$("btn-cancel-add-unit").onclick = () => hvShowScreen("screen-main");

$("btn-submit-unit").onclick = async () => {
  const status = $("add-unit-status");
  const token = hvGetValidToken();
  const outboxId = window.hvOutboxId;
  const name = $("unit-name").value.trim();
  const locationId = $("unit-location").value;
  const groupId = $("unit-group").value;
  if (!token || !outboxId) {
    status.textContent = "Κάνε πρώτα ανανέωση στην κύρια οθόνη.";
    status.className = "status error";
    return;
  }
  if (!name || !locationId || !groupId) {
    status.textContent = "Όνομα, τοποθεσία και ομάδα είναι υποχρεωτικά.";
    status.className = "status error";
    return;
  }
  const payload = {
    name,
    location_id: Number(locationId),
    group_id: Number(groupId),
    model: $("unit-model").value.trim(),
    serial_number: $("unit-serial").value.trim(),
    notes: $("unit-notes").value.trim(),
    installation_date: $("unit-installation-date").value || null,
  };
  $("btn-submit-unit").disabled = true;
  status.textContent = "Αποστολή…";
  status.className = "status";
  try {
    const localId = await hvSubmitUnitCreate(token, outboxId, payload);
    hvAddPendingLog({ kind: "unit", localId, text: `Νέα μονάδα: ${name}` });
    status.textContent = "✓ Στάλθηκε.";
    status.className = "status ok";
    setTimeout(() => hvShowScreen("screen-main"), 600);
  } catch (err) {
    status.textContent = "Σφάλμα: " + err.message;
    status.className = "status error";
  } finally {
    $("btn-submit-unit").disabled = false;
  }
};

// --- Προσθήκη συνημμένου ---
function hvPopulateAttachmentEntitySelect() {
  const type = $("attachment-entity-type").value;
  const sel = $("attachment-entity");
  const snap = window.hvSnapshot || {};
  $("attachment-entity-label").textContent = type === "task" ? "Εργασία" : "Μονάδα";
  let options = [];
  if (type === "unit") {
    const pendingUnits = hvPendingUnits().map(
      (e) => `<option value="local:${e.localId}">(εκκρεμεί συγχρονισμός) ${hvEscapeHtml(e.text.replace(/^Νέα μονάδα:\s*/, ""))}</option>`
    );
    const realUnits = (snap.units || []).map(
      (u) => `<option value="real:${u.id}">${hvEscapeHtml(u.name)}${u.location ? " — " + hvEscapeHtml(u.location) : ""}</option>`
    );
    options = pendingUnits.concat(realUnits);
  } else {
    options = (snap.tasks || []).map(
      (t) => `<option value="real:${t.id}">${hvEscapeHtml(t.description || "(χωρίς περιγραφή)")}${t.unit_name ? " — " + hvEscapeHtml(t.unit_name) : ""}</option>`
    );
  }
  sel.innerHTML = options.length ? options.join("") : '<option value="">— Δεν υπάρχουν διαθέσιμα —</option>';
}

$("btn-add-attachment").onclick = () => {
  $("attachment-entity-type").value = "unit";
  $("attachment-files").value = "";
  $("add-attachment-status").textContent = "";
  $("add-attachment-status").className = "status";
  hvPopulateAttachmentEntitySelect();
  hvShowScreen("screen-add-attachment");
};

$("attachment-entity-type").onchange = hvPopulateAttachmentEntitySelect;

$("btn-cancel-add-attachment").onclick = () => hvShowScreen("screen-main");

$("btn-submit-attachment").onclick = async () => {
  const status = $("add-attachment-status");
  const token = hvGetValidToken();
  const outboxId = window.hvOutboxId;
  const type = $("attachment-entity-type").value;
  const entityVal = $("attachment-entity").value;
  const files = $("attachment-files").files;
  if (!token || !outboxId) {
    status.textContent = "Κάνε πρώτα ανανέωση στην κύρια οθόνη.";
    status.className = "status error";
    return;
  }
  if (!entityVal) {
    status.textContent = "Επίλεξε μονάδα ή εργασία.";
    status.className = "status error";
    return;
  }
  if (!files || !files.length) {
    status.textContent = "Επίλεξε τουλάχιστον ένα αρχείο.";
    status.className = "status error";
    return;
  }
  const [kind, rawId] = entityVal.split(":");
  const entityId = kind === "real" ? rawId : null;
  const localUnitRef = kind === "local" ? rawId : null;
  const entityLabel = $("attachment-entity").selectedOptions[0].textContent;
  $("btn-submit-attachment").disabled = true;
  try {
    for (let i = 0; i < files.length; i++) {
      status.textContent = `Αποστολή ${i + 1}/${files.length}…`;
      status.className = "status";
      const file = files[i];
      await hvSubmitAttachment(token, outboxId, type, entityId, localUnitRef, file);
      hvAddPendingLog({ kind: "attachment", text: `Συνημμένο: ${entityLabel} — ${file.name}` });
    }
    status.textContent = "✓ Στάλθηκαν.";
    status.className = "status ok";
    setTimeout(() => hvShowScreen("screen-main"), 600);
  } catch (err) {
    status.textContent = "Σφάλμα: " + err.message;
    status.className = "status error";
  } finally {
    $("btn-submit-attachment").disabled = false;
  }
};

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
