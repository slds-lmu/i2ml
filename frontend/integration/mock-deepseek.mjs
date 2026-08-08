import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 8999;

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer((request, response) => {
  if (request.method === "GET") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(response, 400, { error: "invalid JSON" });
      return;
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const hasToolResult = messages.at(-1)?.role === "tool";
    const message = hasToolResult
      ? {
          role: "assistant",
          content: "Integration debug answer from the local provider.",
          reasoning_content: "Integration-only reasoning after the validated tool result."
        }
      : {
          role: "assistant",
          content: "",
          reasoning_content: "Integration-only reasoning before requesting the course search tool.",
          tool_calls: [
            {
              id: "integration_search_1",
              type: "function",
              function: {
                name: "search_course",
                arguments: JSON.stringify({
                  query: "machine learning",
                  allowed_scope: ["i2ml-01-01"],
                  top_k: 1
                })
              }
            }
          ]
        };
    sendJson(response, 200, {
      choices: [
        {
          finish_reason: hasToolResult ? "stop" : "tool_calls",
          message
        }
      ],
      model: "deepseek-v4-flash-integration-stub",
      system_fingerprint: "local-integration-stub",
      usage: {
        prompt_tokens: 20,
        completion_tokens: hasToolResult ? 8 : 0,
        total_tokens: hasToolResult ? 28 : 20,
        prompt_cache_hit_tokens: hasToolResult ? 12 : 0,
        prompt_cache_miss_tokens: hasToolResult ? 8 : 20
      }
    });
  });
});

server.listen(port, host);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
