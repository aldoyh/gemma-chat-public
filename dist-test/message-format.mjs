// src/main/inference/message-format.ts
function appendMessage(messages, role, content) {
  const trimmed = content.trim();
  if (!trimmed) return;
  const last = messages[messages.length - 1];
  if (last?.role === role) {
    last.content = `${last.content}

${trimmed}`;
    return;
  }
  messages.push({ role, content: trimmed });
}
function formatMessagesForMLX(messages) {
  const formatted = [];
  let pendingUserContent = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === "system") {
      pendingUserContent.push(`System instructions:
${content}`);
      continue;
    }
    if (message.role === "tool") {
      pendingUserContent.push(`Tool result:
${content}`);
      continue;
    }
    if (message.role === "user") {
      pendingUserContent.push(content);
      appendMessage(formatted, "user", pendingUserContent.join("\n\n"));
      pendingUserContent = [];
      continue;
    }
    if (pendingUserContent.length > 0) {
      appendMessage(formatted, "user", pendingUserContent.join("\n\n"));
      pendingUserContent = [];
    }
    appendMessage(formatted, "assistant", content);
  }
  if (pendingUserContent.length > 0) {
    appendMessage(formatted, "user", pendingUserContent.join("\n\n"));
  }
  return formatted;
}
export {
  formatMessagesForMLX
};
