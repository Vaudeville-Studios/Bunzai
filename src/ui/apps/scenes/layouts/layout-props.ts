/** Shared input to additional chat presentations; the scene page retains all data and turn writers. */
import type { JSX, ReactNode } from "react";
import type { ChatLayout } from "../chat-layout";
import type { Wing } from "../scene-wing-data";
import type { Program } from "../messenger/programs";
import type { MessengerRequest } from "../messenger/use-messenger-nav";
export interface LayoutProps {
  layout: Exclude<ChatLayout, "stage" | "messenger">;
  name: string;
  chatId: string;
  portrait: ReactNode;
  backdrop: ReactNode;
  actions: ReactNode;
  wings: readonly Wing[];
  wing: string | null;
  onWing(id: string | null): void;
  renderWing(id: string): JSX.Element;
  programs: readonly Program[];
  request: MessengerRequest | null;
  renderProgram(program: Program): ReactNode;
  onSurface(open: boolean): void;
  onBack(): void;
  children: ReactNode;
}
