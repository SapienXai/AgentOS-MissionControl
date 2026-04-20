import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveAgentChatLatestAssistantAt,
  resolveAgentChatUnreadCount,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";

test("agent chat unread counts only completed assistant replies", () => {
  const messages: AgentChatMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "Hello",
      createdAt: 1,
      status: "sent"
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "Still thinking",
      createdAt: 2
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "Final answer",
      createdAt: 3,
      status: "sent"
    }
  ];

  assert.equal(resolveAgentChatLatestAssistantAt(messages), 3);
  assert.equal(resolveAgentChatUnreadCount(messages, null), 1);
  assert.equal(resolveAgentChatUnreadCount(messages, 1), 1);
  assert.equal(resolveAgentChatUnreadCount(messages, 3), 0);
});
