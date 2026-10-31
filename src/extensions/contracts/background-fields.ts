/** Exact policy fields for reviewed, host-owned turn follow-on persistence. */
export const EXTENSION_BACKGROUND_FIELDS = {
  compendiumEntries: "lorebook.entries.write",
  compendiumReceipts: "compendium.receipts.write",
  summaryAutomatic: "summary.automatic.write",
  summaryError: "summary.error.write",
} as const;
