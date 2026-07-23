// Ρυθμίσεις Google Cloud για το HVACR Mobile PWA.
// CLIENT_ID / API_KEY δεν είναι μυστικά — προστατεύονται από τους περιορισμούς
// (Authorized origin / HTTP referrer) που μπήκαν στο Google Cloud Console.
window.HVACR_CONFIG = {
  CLIENT_ID: "477049134864-pavotomaovnvogkhhfr8pl9l6lcabu59.apps.googleusercontent.com",
  API_KEY: "AIzaSyAVDrnh6rgJ9G1XD0mjnWzwPEe9QX6gVl8",
  PROJECT_NUMBER: "477049134864",
  // Μόνο πρόσβαση σε αρχεία που δημιουργεί/επιλέγει η ίδια η εφαρμογή (drive.file), όχι όλο το Drive.
  SCOPES: "https://www.googleapis.com/auth/drive.file",
};
