/** The finite decorative reader cast: stable preferences, image imports and original-reader fallback. */
import original from "./interviewer.png";
import youngWoman from "./reader-young-woman.png";
import middleAgedMan from "./reader-middle-aged-man.png";
import olderWoman from "./reader-older-woman.png";
import olderMan from "./reader-older-man.png";

export const READER_PREF = "table-read.reader";
export const READER_ART = [
  { id: "original", label: "Androgynous adult", image: original },
  { id: "young-woman", label: "Young woman", image: youngWoman },
  { id: "middle-aged-man", label: "Middle-aged man", image: middleAgedMan },
  { id: "older-woman", label: "Older woman", image: olderWoman },
  { id: "older-man", label: "Older man", image: olderMan },
] as const;
export type ReaderArt = (typeof READER_ART)[number];

export const readerArt = (value: unknown): ReaderArt => READER_ART.find((reader) => reader.id === value) ?? READER_ART[0];
