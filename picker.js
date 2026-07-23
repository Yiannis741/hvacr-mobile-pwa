// Google Picker — επιλογή, μία φορά, του κοινόχρηστου φακέλου συγχρονισμού στο Drive.
// Με scope drive.file, η εφαρμογή αποκτά πρόσβαση ΜΟΝΟ στον φάκελο (και τα περιεχόμενά
// του) που θα επιλέξει ρητά ο χρήστης εδώ — όχι σε όλο το Google Drive.
let hvPickerLoaded = false;

function hvOpenFolderPicker(token, onPicked) {
  function show() {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes("application/vnd.google-apps.folder");
    const picker = new google.picker.PickerBuilder()
      .setTitle("Επίλεξε τον φάκελο συγχρονισμού (π.χ. HVACR-Maintenance-401)")
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(window.HVACR_CONFIG.API_KEY)
      .setAppId(window.HVACR_CONFIG.PROJECT_NUMBER)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const folder = data.docs[0];
          onPicked(folder.id, folder.name);
        }
      })
      .build();
    picker.setVisible(true);
  }
  if (hvPickerLoaded) {
    show();
  } else {
    gapi.load("picker", () => {
      hvPickerLoaded = true;
      show();
    });
  }
}
