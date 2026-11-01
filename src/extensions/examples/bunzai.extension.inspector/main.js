import { bunzai } from "bunzai-extension-sdk";

bunzai.extension.define({
  commands: {
    inspect: async () => {
      const availableOperations = [];
      let offset = 0;
      do {
        const page = await bunzai.operations.apiDescribe({ offset, limit: 20 });
        availableOperations.push(...page.operations.map((operation) => ({ id: operation.id, granted: operation.granted })));
        offset = page.nextOffset ?? -1;
      } while (offset >= 0);
      return { availableOperations };
    },
  },
});
