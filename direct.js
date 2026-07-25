// Δεύτερος, εναλλακτικός τρόπος επικοινωνίας με τον υπολογιστή — απευθείας μέσω δικτύου
// (π.χ. Tailscale), ΧΩΡΙΣ Google Drive και ΧΩΡΙΣ Google Sign-In. Ο χρήστης βάζει τη
// διεύθυνση του υπολογιστή (π.χ. http://100.x.x.x:8767) και το token που δείχνει η σελίδα
// Ρυθμίσεις του desktop (κάρτα "Άμεση Σύνδεση Κινητού (Tailscale)"). Το backend
// (web_experiment/server.py) εκθέτει:
//   GET  /api/mobile/snapshot            -> ίδιο σχήμα δεδομένων με το snapshot.json του Drive
//   POST /api/mobile/sync   {requests:[]} -> εφαρμόζει ΑΜΕΣΑ (όχι μετά από συγχρονισμό)
//   POST /api/mobile/attachment?...       -> ανέβασμα ΑΚΑΤΕΡΓΑΣΤΩΝ bytes (χωρίς base64 στο
//                                            κινητό — ίδια λογική ασφάλειας μνήμης με το
//                                            hvDriveUploadBlob του drive.js)
// Όλα τα αιτήματα κουβαλάνε header X-HV-Token — το ίδιο token ελέγχει και ο desktop server
// για ΚΑΘΕ request που δεν έρχεται από το ίδιο το μηχάνημα (127.0.0.1), βλ. server.py.
(function () {
  function normalizeUrl(u) {
    return String(u || "").trim().replace(/\/+$/, "");
  }

  window.hvDirectGetConfig = function () {
    return {
      enabled: localStorage.getItem("hv_direct_enabled") === "1",
      url: localStorage.getItem("hv_direct_url") || "",
      token: localStorage.getItem("hv_direct_token") || "",
    };
  };

  window.hvDirectSetConfig = function (cfg) {
    if (cfg.url !== undefined) localStorage.setItem("hv_direct_url", normalizeUrl(cfg.url));
    if (cfg.token !== undefined) localStorage.setItem("hv_direct_token", String(cfg.token || "").trim());
    if (cfg.enabled !== undefined) localStorage.setItem("hv_direct_enabled", cfg.enabled ? "1" : "");
    // Οι browsers (ειδικά σε http, όχι https, όπως εδώ) μπορούν να "καθαρίσουν" μόνοι
    // τους localStorage χαμηλής προτεραιότητας όποτε χρειαστούν χώρο ή μετά από πλήρες
    // κλείσιμο του browser — ζητάμε ρητά "μόνιμη" αποθήκευση ώστε τα στοιχεία σύνδεσης να
    // μην χαθούν. Ο browser μπορεί να το αρνηθεί σιωπηλά (π.χ. αν η σελίδα δεν είναι
    // "εγκατεστημένη" στην αρχική οθόνη) — γι' αυτό συνιστούμε ΚΑΙ "Προσθήκη στην αρχική
    // οθόνη" στον χρήστη, που αυξάνει σημαντικά τις πιθανότητες να εγκριθεί.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  };

  window.hvDirectClearConfig = function () {
    localStorage.removeItem("hv_direct_enabled");
    localStorage.removeItem("hv_direct_url");
    localStorage.removeItem("hv_direct_token");
  };

  // true μόνο αν είναι ΚΑΙ ενεργοποιημένο ΚΑΙ έχουν δοθεί διεύθυνση+token — έτσι ό,τι
  // κώδικας ελέγχει hvDirectActive() δεν χρειάζεται να ξαναελέγξει τα επιμέρους πεδία.
  window.hvDirectActive = function () {
    const cfg = window.hvDirectGetConfig();
    return !!(cfg.enabled && cfg.url && cfg.token);
  };

  const HV_DIRECT_TIMEOUT_MS = 12000;

  async function hvDirectFetch(path, options) {
    const cfg = window.hvDirectGetConfig();
    if (!cfg.url || !cfg.token) throw new Error("Δεν έχει ρυθμιστεί η Άμεση Σύνδεση.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HV_DIRECT_TIMEOUT_MS);
    try {
      const r = await fetch(cfg.url + path, {
        ...options,
        signal: controller.signal,
        headers: { "X-HV-Token": cfg.token, ...(options && options.headers) },
      });
      if (!r.ok) {
        let msg = "Σφάλμα σύνδεσης (" + r.status + ").";
        try {
          const d = await r.json();
          if (d && d.error) msg = d.error;
        } catch (e) {
          /* όχι JSON απάντηση — κρατάμε το γενικό μήνυμα */
        }
        throw new Error(msg);
      }
      return await r.json();
    } catch (err) {
      if (err.name === "AbortError") throw new Error("Δεν απάντησε ο υπολογιστής — έλεγξε ότι είναι ανοιχτός και ότι το Tailscale είναι συνδεδεμένο.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  window.hvDirectFetchSnapshot = function () {
    return hvDirectFetch("/api/mobile/snapshot", { method: "GET" });
  };

  window.hvDirectSync = function (requests) {
    return hvDirectFetch("/api/mobile/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
  };

  // Βολικό wrapper για ΕΝΑ αίτημα — επιστρέφει το αποτέλεσμά του (π.χ. {server_id}) ή
  // πετάει σφάλμα αν το backend το απέρριψε.
  window.hvDirectSyncOne = async function (type, payload) {
    const data = await window.hvDirectSync([{ type, payload }]);
    const r = (data && data.results && data.results[0]) || null;
    if (!r || r.ok === false) throw new Error((r && r.error) || "Ο υπολογιστής απέρριψε το αίτημα.");
    return r;
  };

  // Ανέβασμα συνημμένου: ΑΚΑΤΕΡΓΑΣΤΑ bytes απευθείας ως σώμα του request (όχι JSON/base64 —
  // βλ. σχόλιο στην κορυφή του αρχείου). Το entityId πρέπει να είναι ΗΔΗ πραγματικό
  // (numeric) id — σε Direct mode δεν υπάρχει η έννοια "local_unit_ref" αφού το unit.create
  // εφαρμόζεται συγχρονισμένα και το πραγματικό id είναι διαθέσιμο αμέσως.
  window.hvDirectUploadAttachment = async function (entityType, entityId, file) {
    const cfg = window.hvDirectGetConfig();
    if (!cfg.url || !cfg.token) throw new Error("Δεν έχει ρυθμιστεί η Άμεση Σύνδεση.");
    const qs = new URLSearchParams({
      entity_type: entityType,
      entity_id: String(entityId),
      name: file.name || "attachment",
      mime_type: file.type || "",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const r = await fetch(cfg.url + "/api/mobile/attachment?" + qs.toString(), {
        method: "POST",
        signal: controller.signal,
        headers: { "X-HV-Token": cfg.token, "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!r.ok) {
        let msg = "Αποτυχία ανεβάσματος συνημμένου (" + r.status + ").";
        try {
          const d = await r.json();
          if (d && d.error) msg = d.error;
        } catch (e) {}
        throw new Error(msg);
      }
      return await r.json();
    } catch (err) {
      if (err.name === "AbortError") throw new Error("Χρονικό όριο ανεβάσματος — δοκίμασε ξανά.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  // Χρησιμοποιείται από την οθόνη ρυθμίσεων σύνδεσης πριν αποθηκεύσει — δοκιμάζει με τα
  // δοσμένα (όχι ακόμα αποθηκευμένα) url/token, ώστε ο χρήστης να μάθει αμέσως αν κάτι δεν
  // πάει καλά αντί να το ανακαλύψει αργότερα στην κύρια οθόνη.
  window.hvDirectTestConnection = async function (url, token) {
    const cleanUrl = normalizeUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HV_DIRECT_TIMEOUT_MS);
    try {
      const r = await fetch(cleanUrl + "/api/mobile/snapshot", {
        method: "GET",
        signal: controller.signal,
        headers: { "X-HV-Token": String(token || "").trim() },
      });
      if (r.status === 401) throw new Error("Λάθος token.");
      if (!r.ok) throw new Error("Σφάλμα σύνδεσης (" + r.status + ").");
      const d = await r.json();
      return { ok: true, units: (d.units || []).length, tasks: (d.tasks || []).length };
    } catch (err) {
      if (err.name === "AbortError") throw new Error("Δεν απάντησε ο υπολογιστής — έλεγξε τη διεύθυνση και ότι το Tailscale είναι συνδεδεμένο.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  // Ζητάμε "μόνιμη" αποθήκευση και σε κάθε φόρτωμα της σελίδας (όχι μόνο τη στιγμή της
  // σύνδεσης) — καλύπτει και όσους συνδέθηκαν πριν προστεθεί αυτό το request.
  if (window.hvDirectActive && window.hvDirectActive() && navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
})();
