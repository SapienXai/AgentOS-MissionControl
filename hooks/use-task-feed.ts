import { useEffect, useState } from "react";
import type { TaskDetailRecord, TaskFeedEvent, TaskDetailStreamEvent } from "@/lib/agentos/contracts";

const EMPTY_TASK_FEED: TaskFeedEvent[] = [];

export function useTaskFeed(
  taskId: string,
  enabled: boolean,
  options: {
    dispatchId?: string | null;
    optimisticFeed?: TaskFeedEvent[];
  } = {}
) {
  const [feedState, setFeedState] = useState<{
    taskId: string | null;
    feed: TaskFeedEvent[];
    detail: TaskDetailRecord | null;
  }>({
    taskId: null,
    feed: [],
    detail: null
  });
  const [connectedTaskId, setConnectedTaskId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ taskId: string | null; message: string | null }>({
    taskId: null,
    message: null
  });
  const dispatchId = typeof options.dispatchId === "string" && options.dispatchId.trim() ? options.dispatchId.trim() : null;
  const isOptimisticTask = taskId.startsWith("optimistic-task:");
  const optimisticFeed = enabled && isOptimisticTask && !dispatchId ? options.optimisticFeed ?? EMPTY_TASK_FEED : null;

  useEffect(() => {
    if (!enabled || optimisticFeed) {
      return;
    }

    const searchParams = new URLSearchParams();
    if (dispatchId) {
      searchParams.set("dispatchId", dispatchId);
    }
    const streamUrl = `/api/tasks/${encodeURIComponent(taskId)}/stream${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
    const eventSource = new EventSource(streamUrl);

    const handleTask = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TaskDetailStreamEvent;
        if (data.type === "task") {
          setFeedState({ taskId, feed: data.detail.liveFeed || [], detail: data.detail });
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
  }, [taskId, enabled, dispatchId, optimisticFeed]);

  const feed = optimisticFeed ?? (feedState.taskId === taskId ? feedState.feed : []);
  const detail = optimisticFeed ? null : feedState.taskId === taskId ? feedState.detail : null;
  const error = optimisticFeed ? null : errorState.taskId === taskId ? errorState.message : null;
  const loading = optimisticFeed ? false : enabled && connectedTaskId !== taskId && error === null;

  return { feed, detail, loading, error };
}
