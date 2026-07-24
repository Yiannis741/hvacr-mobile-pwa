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

// Σμικρύνει/συμπιέζει φωτογραφίες πριν το ανέβασμα (μεγ. διάσταση 1600px, JPEG ~75%).
// Οι σύγχρονες κάμερες κινητών βγάζουν φωτογραφίες 12-108MP. ΣΗΜΑΝΤΙΚΟ: περνάμε
// resizeWidth/resizeHeight ΑΠΕΥΘΕΙΑΣ στο createImageBitmap ώστε ο browser να κάνει
// "scaled decode" στο μέγεθος-στόχο κατά την αποκωδικοποίηση της εικόνας. Η πρώτη έκδοση
// αυτής της συνάρτησης έκανε createImageBitmap(file) ΧΩΡΙΣ resize options — δηλαδή
// αποκωδικοποιούσε πρώτα ΟΛΟΚΛΗΡΗ τη φωτογραφία σε πλήρη ανάλυση (π.χ. μια φωτογραφία
// 4000x3000 = 48MB raw pixels, μια 108MP φωτογραφία = ~430MB) ΚΑΙ ΜΕΤΑ τη σμίκρυνε με
// canvas — αυτό το πρώτο, ακριβό βήμα ήταν που έσκαγε τη μνήμη σε αδύναμα κινητά, ακόμα
// και μετά τη βελτίωση του base64 encoding. Με resizeWidth/resizeHeight ο αποκωδικοποιητής
// (π.χ. libjpeg στο Chrome/Android) μπορεί να κάνει scaled/DCT decode απευθείας στο μικρό
// μέγεθος, χωρίς ποτέ να χρειαστεί να κρατήσει την πλήρη ανάλυση στη μνήμη.
// Αρχεία που δεν είναι εικόνα (π.χ. PDF) ή είναι ήδη μικρά περνάνε χωρίς αλλαγή.
const HV_IMAGE_MAX_DIM = 1600;
const HV_IMAGE_QUALITY = 0.75;
const HV_IMAGE_SKIP_BELOW_BYTES = 1.2 * 1024 * 1024;
// Αν η "συμπιεσμένη" έξοδος είναι ακόμα πάνω από αυτό, κάτι πήγε στραβά (π.χ. πολύ παλιό
// browser χωρίς υποστήριξη resize) — καλύτερα σαφές μήνυμα λάθους παρά τυφλή αποστολή
// ενός τεράστιου αρχείου που θα ξανασκάσει τη μνήμη στο επόμενο βήμα.
const HV_IMAGE_HARD_LIMIT_BYTES = 6 * 1024 * 1024;

function hvIsCompressibleImage(file) {
  return file && /^image\/(jpeg|png|webp)$/.test(file.type);
}

async function hvCompressImageFile(file) {
  if (!hvIsCompressibleImage(file)) return file;
  if (file.size < HV_IMAGE_SKIP_BELOW_BYTES) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: HV_IMAGE_MAX_DIM,
      resizeQuality: "medium",
    });
  } catch (err) {
    bitmap = null;
  }
  if (!bitmap) {
    // Πολύ παλιό browser χωρίς υποστήριξη resize options στο createImageBitmap.
    if (file.size > HV_IMAGE_HARD_LIMIT_BYTES) {
      throw new Error("Η φωτογραφία είναι πολύ μεγάλη για αυτή τη συσκευή. Δοκίμασε μικρότερη ανάλυση κάμερας ή σμίκρυνέ την πριν την προσθέσεις.");
    }
    return file;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", HV_IMAGE_QUALITY));
    if (!blob) {
      if (file.size > HV_IMAGE_HARD_LIMIT_BYTES) throw new Error("Αποτυχία συμπίεσης φωτογραφίας.");
      return file;
    }
    if (blob.size >= file.size) return file;
    const newName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch (err) {
    if (bitmap && bitmap.close) bitmap.close();
    if (file.size > HV_IMAGE_HARD_LIMIT_BYTES) throw err;
    return file;
  }
}

// ΣΗΜΑΝΤΙΚΟ (2η ρίζα του προβλήματος μνήμης): η παλιά υλοποίηση μετέτρεπε ΚΑΘΕ αρχείο
// (φωτογραφία Ή pdf) σε base64 string και το "έραβε" μέσα σε ένα ακόμα μεγαλύτερο JS
// string (το multipart body) πριν το στείλει — ένα pdf 2.8MB γινόταν ~3.8MB base64 string
// μέσα σε ένα ~4MB+ multipart string, συν ό,τι επιπλέον χρειαζόταν το fetch για να το
// κωδικοποιήσει σε bytes για δίκτυο. Σε πολύ αδύναμο κινητό αυτό έφτανε να σκάσει τη μνήμη
// ΑΝΕΞΑΡΤΗΤΑ από συμπίεση εικόνας (γι' αυτό απέτυχε και σε pdf, που δεν περνάει καν από τη
// συμπίεση εικόνων). Λύση: ανεβάζουμε το ΑΚΑΤΕΡΓΑΣΤΟ Blob/File απευθείας ως σώμα του fetch
// — χωρίς base64, χωρίς string concatenation. Το Drive API v3 δεν υποστηρίζει να δώσεις
// metadata (όνομα/φάκελο) ΚΑΙ raw binary body στο ίδιο request χωρίς multipart, οπότε
// κάνουμε 2 βήματα: (1) δημιουργία του αρχείου με μόνο τα metadata, (2) PATCH με
// uploadType=media για το περιεχόμενο, περνώντας το file object απευθείας ως body.
async function hvDriveUploadBlob(token, parentId, filename, file) {
  const createRes = await fetch(`${HV_DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { ...hvAuthHeaders(token), "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: filename, parents: [parentId] }),
  });
  if (!createRes.ok) throw new Error("Αποτυχία δημιουργίας αρχείου στο Drive (" + createRes.status + ").");
  const created = await createRes.json();
  try {
    const uploadRes = await fetch(`${HV_UPLOAD_API}/files/${created.id}?uploadType=media`, {
      method: "PATCH",
      headers: { ...hvAuthHeaders(token), "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadRes.ok) throw new Error("Αποτυχία αποστολής αρχείου στο Drive (" + uploadRes.status + ").");
    return await uploadRes.json();
  } catch (err) {
    // Καθάρισμα: αν απέτυχε το ανέβασμα περιεχομένου, μη μείνει ορφανό άδειο αρχείο στο Drive.
    fetch(`${HV_DRIVE_API}/files/${created.id}`, { method: "DELETE", headers: hvAuthHeaders(token) }).catch(() => {});
    throw err;
  }
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

// Στέλνει αίτημα μερικής ενημέρωσης εργασίας (task.update) — status/priority/description/notes.
async function hvSubmitTaskUpdate(token, outboxId, taskId, changes) {
  const id = hvUuid();
  const payload = { task_id: taskId, ...changes };
  const request = { id, type: "task.update", payload, created_at: new Date().toISOString() };
  await hvDriveUploadJSON(token, outboxId, `${id}.json`, request);
  return id;
}

// Στέλνει αίτημα προσθήκης συνημμένου (attachment.add). Είτε entityId (υπάρχουσα
// μονάδα/εργασία, όπως εμφανίζεται στο snapshot) είτε localUnitRef (μονάδα που μόλις
// δημιουργήθηκε τοπικά και δεν έχει συγχρονιστεί ακόμα) — όχι και τα δύο.
async function hvSubmitAttachment(token, outboxId, entityType, entityId, localUnitRef, file) {
  const id = hvUuid();
  const uploadFile = await hvCompressImageFile(file);
  const blobName = `${id}_${uploadFile.name}`;
  await hvDriveUploadBlob(token, outboxId, blobName, uploadFile);
  const payload = { entity_type: entityType, file: blobName };
  if (entityId) payload.entity_id = entityId;
  if (localUnitRef) payload.local_unit_ref = localUnitRef;
  const request = { id, type: "attachment.add", payload, created_at: new Date().toISOString() };
  await hvDriveUploadJSON(token, outboxId, `${id}.json`, request);
  return id;
}
