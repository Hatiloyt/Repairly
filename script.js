const translations = {
  de: {
    pageTitle: "Repairly. — Reparaturwissen für Auto und Motorrad",
    description: "Repairly verbindet Auto- und Motorradfans mit Reparaturanleitungen aus der Community.",
    headerHome: "Repairly. Startseite",
    loginLabel: "Anmelden",
    registerLabel: "Registrieren",
    navHow: "So funktioniert’s",
    navAbout: "Verifizierung",
    languageLabel: "Sprache auswählen",
    toggleToDark: "Dunkelmodus einschalten",
    toggleToLight: "Hellmodus einschalten",
    darkMode: "Dunkelmodus",
    lightMode: "Hellmodus",
    logoLabel: "Repairly Logo",
    dialogKicker: "ACCOUNT",
    dialogTitle: "Im Moment noch nicht hier.",
    dialogMessage: "Wende dich bitte an einen Mitarbeiter.",
    dialogClose: "Schließen",
    dialogCloseLabel: "Meldung schließen",
    eyebrow: "DIE COMMUNITY FÜR FAHRZEUGREPARATUREN",
    heroTitle: "Reparaturwissen für Auto und Motorrad.",
    heroCopy: "Finde Reparaturanleitungen für Autos und Motorräder, teile deine eigenen Reparaturen mit Ersatzteil-Links und lass erfolgreiche Lösungen von der Community bestätigen.",
    heroCta: "So funktioniert Repairly",
    heroLink: "Community-Verifizierung",
    placeholderTag: "KONZEPTVORSCHAU · PLATZHALTERTEXTE",
    howKicker: "VON DER COMMUNITY",
    howTitle: "Teilen, nachmachen, gemeinsam verifizieren.",
    howIntro: "Repairly verbindet Menschen, die Reparaturen selbst durchführen, mit denen, die ihr Wissen dazu weitergeben.",
    stepOneTitle: "Reparatur posten",
    stepOneCopy: "Lege einen Account an und veröffentliche deine Reparatur als Beitrag. Beschreibe die Arbeitsschritte für Auto oder Motorrad und verlinke passende Ersatzteile. (Platzhalter)",
    stepTwoTitle: "Reparatur nachmachen",
    stepTwoCopy: "Finde Beiträge zu deinem Fahrzeug, folge der Anleitung und nutze die Ersatzteil-Links für die benötigten Teile. (Platzhalter)",
    stepThreeTitle: "Erfolg verifizieren",
    stepThreeCopy: "Hat die Reparatur funktioniert? Bestätige den erfolgreichen Nachbau mit deinem Account. Bei zehn Bestätigungen wird der Beitrag als verifiziert markiert. (Platzhalter)",
    aboutKicker: "VERTRAUEN DURCH NACHMACHEN",
    aboutTitle: "Zehn erfolgreiche Nachbauten. Ein verifizierter Beitrag.",
    aboutCopy: "Lege einen Account an, teile deine Reparatur-Erfahrungen und probiere Anleitungen anderer aus. Nach erfolgreicher Reparatur kannst du den Beitrag bestätigen. Sobald zehn Personen den Erfolg bestätigt haben, erhält er das Abzeichen „Community-verifiziert“.",
    proofStampOne: "10×",
    proofStampTwo: "ERFOLGREICH",
    proofStampThree: "BESTÄTIGT",
    backToTop: "Zurück nach oben",
    footerLine: "Reparaturen gemeinsam dokumentieren. Inhalte und Funktionen sind Platzhalter."
  },
  en: {
    pageTitle: "Repairly. — Repair knowledge for cars and motorcycles",
    description: "Repairly connects car and motorcycle owners with repair guides shared by the community.",
    headerHome: "Repairly. Home",
    loginLabel: "Log in",
    registerLabel: "Register",
    navHow: "How it works",
    navAbout: "Verification",
    languageLabel: "Choose language",
    toggleToDark: "Switch to dark mode",
    toggleToLight: "Switch to light mode",
    darkMode: "Dark mode",
    lightMode: "Light mode",
    logoLabel: "Repairly logo",
    dialogKicker: "ACCOUNT",
    dialogTitle: "Not available here yet.",
    dialogMessage: "Please contact a staff member.",
    dialogClose: "Close",
    dialogCloseLabel: "Close message",
    eyebrow: "THE VEHICLE REPAIR COMMUNITY",
    heroTitle: "Repair know-how for cars and motorcycles.",
    heroCopy: "Find repair guides for cars and motorcycles, share your own repairs with spare-part links, and let the community confirm successful fixes.",
    heroCta: "How Repairly works",
    heroLink: "Community verification",
    placeholderTag: "CONCEPT PREVIEW · PLACEHOLDER CONTENT",
    howKicker: "POWERED BY THE COMMUNITY",
    howTitle: "Share it, try it, verify it together.",
    howIntro: "Repairly connects people who work on their own vehicles with people ready to share what they know.",
    stepOneTitle: "Post a repair",
    stepOneCopy: "Create an account and publish your repair as a post. Describe the steps for a car or motorcycle repair and link the spare parts you used. (Placeholder)",
    stepTwoTitle: "Try the repair",
    stepTwoCopy: "Find posts for your vehicle, follow the guide, and use its links to get the parts you need. (Placeholder)",
    stepThreeTitle: "Verify success",
    stepThreeCopy: "Did the repair work? Confirm your successful attempt with your account. After ten confirmations, the post is marked as verified. (Placeholder)",
    aboutKicker: "TRUST BUILT BY TRYING",
    aboutTitle: "Ten successful repairs. One verified post.",
    aboutCopy: "Create an account to share your repair experience or try community guides. After a successful repair, confirm the post. When ten people confirm the repair worked for them, the post receives a community-verified badge.",
    proofStampOne: "10×",
    proofStampTwo: "SUCCESSFUL",
    proofStampThree: "CONFIRMED",
    backToTop: "Back to top",
    footerLine: "Document repairs together. Content and features are placeholders."
  }
};

const root = document.documentElement;
const themeButton = document.getElementById("theme-toggle");
const themeLabel = document.getElementById("theme-label");
const languageButtons = Array.from(document.querySelectorAll("[data-language]"));

function setLanguage(language, persist) {
  const nextLanguage = translations[language] ? language : "de";
  const words = translations[nextLanguage];
  root.lang = nextLanguage;
  document.title = words.pageTitle;
  document.querySelector('meta[name="description"]').setAttribute("content", words.description);

  document.querySelectorAll("[data-i18n]").forEach(function (element) {
    const key = element.dataset.i18n;
    if (words[key]) element.textContent = words[key];
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(function (element) {
    const key = element.dataset.i18nAriaLabel;
    if (words[key]) element.setAttribute("aria-label", words[key]);
  });
  languageButtons.forEach(function (button) {
    const active = button.dataset.language === nextLanguage;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateThemeControls(words);

  if (persist) {
    try { localStorage.setItem("repairly-language", nextLanguage); } catch (error) {}
  }
}

function updateThemeControls(words) {
  const dark = root.dataset.theme === "dark";
  themeLabel.textContent = dark ? words.lightMode : words.darkMode;
  themeButton.setAttribute("aria-label", dark ? words.toggleToLight : words.toggleToDark);
  themeButton.setAttribute("aria-pressed", String(dark));
  document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#111713" : "#f5f7f2");
}

themeButton.addEventListener("click", function () {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  updateThemeControls(translations[root.lang] || translations.de);
  try { localStorage.setItem("repairly-theme-v2", root.dataset.theme); } catch (error) {}
});

languageButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    setLanguage(button.dataset.language, true);
  });
});

const accountDialog = document.getElementById("account-dialog");
document.querySelectorAll("[data-account-action]").forEach(function (button) {
  button.addEventListener("click", function () {
    accountDialog.showModal();
  });
});
accountDialog.addEventListener("click", function (event) {
  if (event.target === accountDialog) accountDialog.close();
});
let initialLanguage = "de";
try {
  const storedLanguage = localStorage.getItem("repairly-language");
  if (translations[storedLanguage]) initialLanguage = storedLanguage;
} catch (error) {}
setLanguage(initialLanguage, false);


