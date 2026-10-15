const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const PDF_EXT = "pdf";

export function getExt(filename) {
  return filename.split(".").pop().toLowerCase();
}

export function isImage(filename) {
  return IMAGE_EXTS.includes(getExt(filename));
}

export function isPdf(filename) {
  return getExt(filename) === PDF_EXT;
}

// Files we can't handle client-side: need the user's OS print-to-PDF detour.
export function needsPrintToPdf(filename) {
  return !isImage(filename) && !isPdf(filename);
}

// Per-extension guidance for the print-to-PDF modal, since the menu path
// differs slightly across apps, with a generic fallback for everything else.
export function printInstructionsFor(filename) {
  const ext = getExt(filename);
  const wordSteps = [
    "Open the file in Word.",
    "Go to File → Print (or press Cmd/Ctrl + P).",
    "Choose \u201cSave as PDF\u201d or \u201cMicrosoft Print to PDF\u201d as the printer/destination.",
    "Save the PDF, then upload that file here instead.",
  ];
  const powerpointSteps = [
    "Open the file in PowerPoint.",
    "Go to File → Print (or press Cmd/Ctrl + P).",
    "Choose \u201cSave as PDF\u201d or \u201cMicrosoft Print to PDF\u201d as the printer/destination.",
    "Save the PDF, then upload that file here instead.",
  ];
  const excelSteps = [
    "Open the file in Excel.",
    "Go to File → Print (or press Cmd/Ctrl + P).",
    "Choose \u201cSave as PDF\u201d or \u201cMicrosoft Print to PDF\u201d as the printer/destination.",
    "Save the PDF, then upload that file here instead.",
  ];
  const common = {
    docx: { app: "Word", steps: wordSteps },
    doc: { app: "Word", steps: wordSteps },
    pptx: { app: "PowerPoint", steps: powerpointSteps },
    ppt: { app: "PowerPoint", steps: powerpointSteps },
    xlsx: { app: "Excel", steps: excelSteps },
    xls: { app: "Excel", steps: excelSteps },
    txt: {
      app: "your text editor",
      steps: [
        "Open the file in a text editor.",
        "Use its Print option (Cmd/Ctrl + P).",
        "Choose \u201cSave as PDF\u201d as the destination.",
        "Save the PDF, then upload that file here instead.",
      ],
    },
  };

  return (
    common[ext] || {
      app: "the app that opens this file",
      steps: [
        "Open the file in whatever app opens it by default.",
        "Use its Print option (Cmd/Ctrl + P on most apps).",
        "Choose \u201cSave as PDF\u201d, or \u201cMicrosoft Print to PDF\u201d on Windows, as the destination.",
        "Save the PDF, then upload that file here instead.",
      ],
    }
  );
}

// `n` zero-padded to the width of `last`, and never narrower than
// `minWidth`, so numbered file names sort into numeric order even under a
// plain string sort: page-099 before page-100, where page-99 would not be.
export function padToCount(n, last, minWidth = 2) {
  return String(n).padStart(Math.max(minWidth, String(last).length), "0");
}
