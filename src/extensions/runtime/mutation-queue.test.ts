/** Tests serialized extension lifecycle mutations and queue recovery after a rejected action. */
import { expect, test } from "bun:test";
import { createExtensionMutationQueue } from "./mutation-queue";

test("per-store lifecycle mutations serialize and release after failure", async () => {
  const queue = createExtensionMutationQueue();
  const order: number[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.exclusive(async () => { order.push(1); await held; order.push(2); });
  const second = queue.exclusive(async () => { order.push(3); });
  await Promise.resolve();
  expect(order).toEqual([1]);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual([1, 2, 3]);
});
