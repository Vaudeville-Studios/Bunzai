/** A take's name, shared by both engines' fork routes (scenes.ts forkScene, server-chats-core-messages.ts). */
import type { ChatStore } from "../stage/contracts/chat-store";

/** "Take N", the first number no take of the scene uses, unless a name is given (RoleCall's numbering). */
export async function takeName(chats: Pick<ChatStore, "listBranches">, chatId: string, name?: string): Promise<string> {
  const taken = new Set((await chats.listBranches(chatId)).map((b) => b.name));
  let n = taken.size + 1;
  while (taken.has(`Take ${n}`)) n++;
  return name?.trim() || `Take ${n}`;
}
