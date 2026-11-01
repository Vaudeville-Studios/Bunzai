/**
 * Settings-section registry - the ONE seam for drop-in sections (a browser bundle cannot glob).
 * Adding a section = one file in this folder + one import line here; its act and ordering come from the
 * section itself; nothing else is edited anywhere.
 */
import { SETTINGS_ACTS, type SettingsSection } from "../section-contract";
import about from "./about";
import appearance from "./appearance";
import backups from "./backups";
import connections from "./connections";
import extensions from "./extensions";
import memory from "./memory";
import models from "./models";
import remoteAccess from "./remote-access";
import security from "./security";
import spotify from "./spotify";
import studio from "./studio";
import updates from "./updates";
import workbench from "./workbench";

const SECTIONS: SettingsSection[] = [appearance, extensions, models, connections, spotify, studio, security, backups, workbench, memory, remoteAccess, updates, about];

const actIndex = (section: SettingsSection): number => SETTINGS_ACTS.findIndex((act) => act.id === section.act);

/** The rail's order: act by act, and by the section's own order inside an act. */
export const settingsSections = (): SettingsSection[] => [...SECTIONS].sort((a, b) => actIndex(a) - actIndex(b) || a.order - b.order);
