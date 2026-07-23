// Βοηθητικές συναρτήσεις για το Google Drive API v3 (REST μέσω fetch — χωρίς gapi client,
// μόνο το OAuth access token). Ίδια λογική/σχήμα αιτημάτων με το server.py του desktop.
const HV_DRIVE_API = "https://www.googleapis.com/drive/v3";
const HV_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function hvAuthHeaders(token) {
  return { Authorization: "Bearer " + token };
}

async function hvDriveFindChild(token, parentId, name, mimeType) {
  const safeName = name.replace(/'/g, "\\'");
  let q = `'${parentId}' in parents and name='${safeName}' and trashed=false`;
  if (mimeType) q += ` and mimeType='${mimeType}'`;
  const url = `${HV_DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&spaces=drive`;
  const r = await fetch(url, { headers: hvAuthHeaders(token) });
  if (!r.ok) throw new Error("Αποτυχία αναζήτησης στο Drive (" + r.status + ").");
  const d = await r.json();
  return (d.files && d.files[0]) || null;
}

const HV_FOLDER_MIME = "application/vnd.google-apps.folder";

// Επιστρέφει τα ids των 4 υποφακέλων (outbox/processed/failed/snapshot) μέσα στον
// επιλεγμένο φάκελο συγχρονισμού. Αυτοί δημιουργούνται αυτόματα από τον desktop server
// στο πρώτο "Συγχρονισμός Τώρα" — αν δεν υπάρχουν ακόμα, σημαίνει ότι δεν έχει τρέξει
// ποτέ συγχρονισμός στον υπολογιστή.
async function hvGetSyncFolders(token, rootId) {
  const names = ["outbox", "processed", "failed", "snapshot"];
  const result = {};
  for (const name of names) {
    const f = await hvDriveFindChild(token, rootId, name, HV_FOLDER_MIME);
    result[name] = f ? f.id : null;
  }
  return result;
}

async function hvDriveReadFileText(token, fileId) {
  const r = await fetch(`${HV_DRIVE_API}/files/${fileId}?alt=media`, { headers: hvAuthHeaders(token) });
  if (!r.ok) throw new Error("Αποτυχία ανάγνωσης αρχείου Drive (" + r.status + ").");
  return await r.text();
}

// Διαβάζει το snapshot.json (μονάδες/εργασίες read-only) — γράφεται από τον desktop
// server σε κάθε συγχρονισμό.
async function hvReadSnapshot(token, snapshotFolderId) {
  const file = await hvDriveFindChild(token, snapshotFolderId, "snapshot.json");
  if (!file) throw new Error("Δεν βρέθηκε ακόμα snapshot.json — πρέπει να τρέξει πρώτα συγχρονισμός στον υπολογιστή.");
  const text = await hvDriveReadFileText(token, file.id);
  return JSON.parse(text);
}

function hvMultipartBody(boundary, metadata, contentType, contentBody) {
  return (
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n${contentBody}\r\n` +
    `--${boundary}--`
  );
}

async function hvDriveUploadJSON(token, parentId, filename, obj) {
  const boundary = "hvjson" + Math.random().toString(16).slice(2);
  const metadata = { name: filename, parents: [parentId], mimeType: "application/json" };
  const body = hvMultipartBody(boundary, metadata, "application/json; charset=UTF-8", JSON.stringify(obj));
  const r = await fetch(`${HV_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { ...hvAuthHeaders(token), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error("Αποτυχία αποστολής αιτήματος στο Drive (" + r.status + ").");
  return await r.json();
}

function hvArrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function hvDriveUploadBlob(token, parentId, filename, file) {
  const boundary = "hvblob" + Math.random().toString(16).slice(2);
  const metadata = { name: filename, parents: [parentId] };
  const base64Data = hvArrayBufferToBase64(await file.arrayBuffer());
  const body = hvMultipartBody(
    boundary,
    metadata,
    (file.type || "application/octet-stream") + "\r\nContent-Transfer-Encoding: base64",
    base64Data
  );
  const r = await fetch(`${HV_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { ...hvAuthHeaders(token), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error("Αποτυχία αποστολής αρχείου στο Drive (" + r.status + ").");
  return await r.json();
}

function hvUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Στέλνει αίτημα δημιουργίας νέας μονάδας (unit.create) στο outbox.
// Επιστρέφει το localId του αιτήματος — χρησιμοποίησέ το ως local_unit_ref αν χρειαστεί
// να προσθέσεις συνημμένο στη μονάδα αυτή πριν προλάβει να συγχρονιστεί.
async function hvSubmitUnitCreate(token, outboxId, payload) {
  const id = hvUuid();
  const request = { id, type: "unit.create", payload, created_at: new Date().toISOString() };
  await hvDriveUploadJSON(token, outboxId, `${id}.json`, request);
  return id;
}

// Στέλνει αίτημα προσθήκης συνημμένου (attachment.add). Είτε entityId (υπάρχουσα
// μονάδα/εργασία, όπως εμφανίζεται στο snapshot) είτε localUnitRef (μονάδα που μόλις
// δημιουργήθηκε τοπικά και δεν έχει συγχρονιστεί ακόμα) — όχι και τα δύο.
async function hvSubmitAttachment(token, outboxId, entityType, entityId, localUnitRef, file) {
  const id = hvUuid();
  const blobName = `${id}_${file.name}`;
  await hvDriveUploadBlob(token, outboxId, blobName, file);
  const payload = { entity_type: entityType, file: blobName };
  if (entityId) payload.entity_id = entityId;
  if (localUnitRef) payload.local_unit_ref = localUnitRef;
  const request = { id, type: "attachment.add", payload, created_at: new Date().toISOString() };
  await hvDriveUploadJSON(token, outboxId, `${id}.json`, request);
  return id;
}
