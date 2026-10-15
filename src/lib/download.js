export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// files: array of { name, blob | bytes }
export async function downloadAsZip(files, zipFilename) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.blob || file.bytes);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, zipFilename);
}
