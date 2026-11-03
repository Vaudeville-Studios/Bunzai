/** The Table Read's finite editable surface over the canonical character, shared by interview, UI and save. */
import type { CharacterBody } from "../../entities/character/schema";

export const TABLE_READ_FIELDS = ["name", "tagline", "description", "personality", "scenario", "firstMessage", "exampleMessages"] as const;
export type TableReadField = (typeof TABLE_READ_FIELDS)[number];
export const FIELD_LABELS: Readonly<Record<TableReadField, string>> = {
  name: "Name", tagline: "In one line", description: "Description", personality: "Personality",
  scenario: "Scenario", firstMessage: "Opening message", exampleMessages: "Example dialogue",
};

/** Read one of the interview's known canonical fields; there is no arbitrary path interpreter. */
export function characterField(body: CharacterBody, field: TableReadField): string {
  const fields: Record<TableReadField, string | undefined> = {
    name: body.identity.name, tagline: body.identity.tagline, description: body.identity.description,
    personality: body.persona.personality, scenario: body.persona.scenario,
    firstMessage: body.greetings.firstMessage, exampleMessages: body.examples.exampleMessages,
  };
  return fields[field] ?? "";
}

/** Set a known field without altering other character sections, source or media. */
export function setCharacterField(body: CharacterBody, field: TableReadField, value: string): CharacterBody {
  switch (field) {
    case "name": case "tagline": case "description": return { ...body, identity: { ...body.identity, [field]: value } };
    case "personality": case "scenario": return { ...body, persona: { ...body.persona, [field]: value } };
    case "firstMessage": return { ...body, greetings: { ...body.greetings, firstMessage: value } };
    case "exampleMessages": return { ...body, examples: { ...body.examples, exampleMessages: value } };
  }
}
