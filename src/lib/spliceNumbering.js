// The page numbers shown on the Splice grid: the number each page will
// have in the exported file.
//
// Walks the gaps in order and, within each gap, its queued files in
// order, counting only pages that will be exported. An excluded master
// page, or a queued file whose every page is excluded, has no number of
// its own, so it is labelled with the number the next exported page takes:
// the position it would return to if it were restored.
//
// pageCount           pages in the master document
// inserts             { [gapIndex]: Array<{ id, pageCount, excludedPages }> },
//                     gapIndex N meaning "after master page N"
// excludedMasterPages Set of 1-indexed master page numbers
//
// Returns { inserts: Map(item.id -> { start, end }), master: Map(pageIndex -> n) },
// where pageIndex is the master page's 0-based index. A file that keeps no
// pages has end < start.
export function splicePageNumbers(pageCount, inserts, excludedMasterPages = new Set()) {
  const insertRanges = new Map();
  const masterNumbers = new Map();
  let running = 0;

  for (let gapIndex = 0; gapIndex <= pageCount; gapIndex++) {
    for (const item of inserts[gapIndex] || []) {
      const kept = item.pageCount - (item.excludedPages ? item.excludedPages.size : 0);
      insertRanges.set(item.id, { start: running + 1, end: running + kept });
      running += kept;
    }
    if (gapIndex < pageCount) {
      masterNumbers.set(gapIndex, running + 1);
      if (!excludedMasterPages.has(gapIndex + 1)) running += 1;
    }
  }

  return { inserts: insertRanges, master: masterNumbers };
}
