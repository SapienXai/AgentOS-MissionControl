import { useEffect, useState } from "react";
import type { TaskDetailRecord, TaskFeedEvent, TaskDetailStreamEvent } from "@/lib/openclaw/types";

export function useTaskFeed(taskId: string, expanded: boolean) {
  const [feed, setFeed] = useState<TaskFeedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    setLoading(true);
    // Use fully qualified path if needed or just relative
    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);

    const handleTask = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TaskDetailStreamEvent;
        if (data.type === "task") {
          // The backend sends the full detail including liveFeed
          setFeed(data.detail.liveFeed || []);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to parse task stream event", err);
      }
    };

    const handleError = (event: MessageEvent) => {
         try {
            const data = JSON.parse(event.data);
             setError(data.error || "Unknown error");
         } catch {
             setError("Stream error");
         }
         setLoading(false);
    };

    eventSource.addEventListener("task", handleTask as EventListener);
    eventSource.addEventListener("task-error", handleError as EventListener);

    eventSource.onerror = () => {
      console.log("Task stream connection issue");
      // eventSource.close();
    };

    return () => {
      eventSource.close();
      eventSource.removeEventListener("task", handleTask as EventListener);
      eventSource.removeEventListener("task-error", handleError as EventListener);
    };
  }, [taskId, expanded]);

  return { feed, loading, error };
}
