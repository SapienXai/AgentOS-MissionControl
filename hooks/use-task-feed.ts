import { useEffect, useState } from "react";
import type { TaskFeedEvent, TaskDetailStreamEvent } from "@/lib/openclaw/types";

export function useTaskFeed(taskId: string, expanded: boolean) {
  const [feedState, setFeedState] = useState<{ taskId: string | null; feed: TaskFeedEvent[] }>({
    taskId: null,
    feed: []
  });
  const [connectedTaskId, setConnectedTaskId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ taskId: string | null; message: string | null }>({
    taskId: null,
    message: null
  });

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);

    const handleTask = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TaskDetailStreamEvent;
        if (data.type === "task") {
          setFeedState({ taskId, feed: data.detail.liveFeed || [] });
          setConnectedTaskId(taskId);
          setErrorState({ taskId, message: null });
        }
      } catch (err) {
        console.error("Failed to parse task stream event", err);
        setErrorState({ taskId, message: "Unable to parse task feed." });
      }
    };

    const handleError = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        setErrorState({ taskId, message: data.error || "Unknown error" });
      } catch {
        setErrorState({ taskId, message: "Stream error" });
      }
    };

    eventSource.addEventListener("task", handleTask as EventListener);
    eventSource.addEventListener("task-error", handleError as EventListener);

    eventSource.onerror = () => {
      setErrorState((current) =>
        current.taskId === taskId && current.message
          ? current
          : { taskId, message: "Task feed disconnected. Reconnecting…" }
      );
    };

    return () => {
      eventSource.close();
      eventSource.removeEventListener("task", handleTask as EventListener);
      eventSource.removeEventListener("task-error", handleError as EventListener);
    };
  }, [taskId, expanded]);

  const feed = feedState.taskId === taskId ? feedState.feed : [];
  const error = errorState.taskId === taskId ? errorState.message : null;
  const loading = expanded && connectedTaskId !== taskId && error === null;

  return { feed, loading, error };
}
