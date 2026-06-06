// Live MCP smoke test: spins up the built stdio server as a subprocess, connects
// with the official MCP client, lists tools, and (optionally) exercises them
// against the LIVE OpenRouter API. NOT shipped in the package — a dev/CI aid.
//
// Usage:
//   node scripts/smoke-mcp.mjs                 # list tools only
//   node scripts/smoke-mcp.mjs image           # + cheap live image gen
//   node scripts/smoke-mcp.mjs video           # + cheapest live video sync
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mode = process.argv[2] ?? "list";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

function show(label, res) {
  const text = res.content?.map((c) => c.text).join("\n") ?? "";
  console.log(`\n=== ${label} (isError=${res.isError ?? false}) ===\n${text}`);
}

if (mode === "list" || mode === "all") {
  show("list_media_models (video)", await client.callTool({ name: "list_media_models", arguments: { kind: "video" } }));
}

if (mode === "image" || mode === "all") {
  show(
    "generate_image",
    await client.callTool({
      name: "generate_image",
      arguments: { prompt: "A single small blue dot on a white background, minimal", model: "google/gemini-3.1-flash-image-preview" },
    }),
  );
}

if (mode === "video" || mode === "all") {
  show(
    "generate_video_sync",
    await client.callTool({
      name: "generate_video_sync",
      arguments: {
        prompt: "A red ball rolling slowly across a white table",
        model: "google/veo-3.1-lite",
        resolution: "720p",
        duration: 4,
        aspect_ratio: "16:9",
        generate_audio: false,
        timeout_sec: 420,
        poll_interval_sec: 8,
      },
    }),
  );
}

await client.close();
process.exit(0);
