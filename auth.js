// Google Identity Services — απόκτηση OAuth access token (χωρίς redirect, client-side μόνο).
let hvTokenClient = null;
let hvAccessToken = null;

function hvInitAuth() {
  hvTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: window.HVACR_CONFIG.CLIENT_ID,
    scope: window.HVACR_CONFIG.SCOPES,
    callback: (resp) => {
      if (resp.error) {
        hvOnAuthError(resp.error);
        return;
      }
      hvAccessToken = resp.access_token;
      const expiresAt = Date.now() + (Number(resp.expires_in || 3500) * 1000) - 60000;
      sessionStorage.setItem("hv_token", hvAccessToken);
      sessionStorage.setItem("hv_token_expires", String(expiresAt));
      hvOnAuthSuccess(hvAccessToken);
    },
  });
}

function hvGetValidToken() {
  const tok = sessionStorage.getItem("hv_token");
  const exp = Number(sessionStorage.getItem("hv_token_expires") || 0);
  if (tok && Date.now() < exp) {
    hvAccessToken = tok;
    return tok;
  }
  return null;
}

function hvSignIn(interactive) {
  hvTokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
}

function hvSignOut() {
  const tok = hvGetValidToken();
  if (tok && window.google && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(tok, () => {});
  }
  sessionStorage.removeItem("hv_token");
  sessionStorage.removeItem("hv_token_expires");
  localStorage.removeItem("hv_folder_id");
  localStorage.removeItem("hv_folder_name");
  hvAccessToken = null;
}

// Οι παρακάτω συναρτήσεις ορίζονται στο app.js — placeholders εδώ ώστε το auth.js
// να μπορεί να φορτωθεί ανεξάρτητα χωρίς σφάλμα αν το app.js δεν έχει φορτώσει ακόμα.
function hvOnAuthSuccess(token) {
  if (window.onHvAuthSuccess) window.onHvAuthSuccess(token);
}
function hvOnAuthError(err) {
  if (window.onHvAuthError) window.onHvAuthError(err);
}
