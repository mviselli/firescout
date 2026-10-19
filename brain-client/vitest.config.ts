import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "brain-client", environment: "node" },
});
