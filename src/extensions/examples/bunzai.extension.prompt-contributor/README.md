# Prompt contributor example

The package contributes one short candidate to the `system.append` stage for `scene-1`. The manifest declares the prompt hook ID and priority; the event handler uses `prompts.contribute` only while the host runs an explicit prompt preview or active prompt hook. The text is bounded and is not a general prompt replacement.

Grant `prompts.contribute` for the exact scene and `system.append` field. Prompt preview runs the host hook and shows its resulting preview before any generation. This example does not invoke a model or modify the saved scene.
