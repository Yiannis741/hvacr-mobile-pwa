// OAuth2 (implicit flow) μέσω πλήρους ανακατεύθυνσης σελίδας.
// Δεν χρησιμοποιούμε popup (google.accounts.oauth2.initTokenClient) γιατί σε πολλά
// mobile browsers το popup χάνει τη σύνδεση με τη σελίδα που το άνοιξε (window.opener)
// και το access token δεν επιστρέφει ποτέ πίσω — προκαλώντας ατέρμονο loop στο sign-in.
// Η πλήρης ανακατεύθυνση δουλεύει αξιόπιστα παντού.
const HV_REDIRECT_URI = window.location.origin + window.location.pathname;

function hvBuildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: window.HVACR_CONFIG.CLIENT_ID,
    redirect_uri: HV_REDIRECT_URI,
    response_type: "token",
    scope: window.HVACR_CONFIG.SCOPES,
    include_granted_scopes: "true",
    prompt: "select_account",
    state: state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

function hvSignIn() {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem("hv_oauth_state", state);
  window.location.href = hvBuildAuthUrl(state);
}

// ΣΗΜΑΝΤΙΚΟ: το access token αποθηκεύεται σε localStorage (όχι sessionStorage). Όταν
// ανοίγει η κάμερα του κινητού για νέα φωτογραφία, το Android μπορεί να σκοτώσει τη
// διεργασία του Chrome tab για να ελευθερώσει μνήμη (φυσιολογικό σε αδύναμα κινητά — εκτός
// ελέγχου του web app). Με sessionStorage αυτό σήμαινε πλήρη αποσύνδεση κάθε φορά (χαμένο
// token, ξανά Google login/consent). Με localStorage το token επιβιώνει και ο χρήστης απλά
// βλέπει την κύρια οθόνη ήδη συνδεδεμένη μετά την επιστροφή, χωρίς νέο login.
function hvGetValidToken() {
  const tok = localStorage.getItem("hv_token");
  const exp = Number(localStorage.getItem("hv_token_expires") || 0);
  if (tok && Date.now() < exp) return tok;
  return null;
}

// Καλείται στην εκκίνηση της σελίδας. Αν μόλις επιστρέψαμε από τη Google (το access
// token φτάνει στο URL fragment μετά την ανακατεύθυνση), το αποθηκεύει και καθαρίζει
// το URL. Επιστρέφει το token, ή null αν δεν υπάρχει/απέτυχε.
function hvConsumeAuthRedirect() {
  const hash = window.location.hash ? window.location.hash.slice(1) : "";
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const error = params.get("error");
  if (!token && !error) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (error) {
    window.hvLastAuthError = error;
    return null;
  }
  const expectedState = sessionStorage.getItem("hv_oauth_state");
  const state = params.get("state");
  sessionStorage.removeItem("hv_oauth_state");
  if (expectedState && state !== expectedState) {
    window.hvLastAuthError = "Μη έγκυρη απάντηση σύνδεσης (state mismatch).";
    return null;
  }
  const expiresIn = Number(params.get("expires_in") || 3500);
  const expiresAt = Date.now() + expiresIn * 1000 - 60000;
  localStorage.setItem("hv_token", token);
  localStorage.setItem("hv_token_expires", String(expiresAt));
  return token;
}

function hvSignOut() {
  const tok = hvGetValidToken();
  localStorage.removeItem("hv_token");
  localStorage.removeItem("hv_token_expires");
  localStorage.removeItem("hv_folder_id");
  localStorage.removeItem("hv_folder_name");
  if (tok) {
    fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(tok), { method: "POST" }).catch(() => {});
  }
}
