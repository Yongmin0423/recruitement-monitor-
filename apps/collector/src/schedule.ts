export type CollectionWindow = "morning" | "workday" | "evening" | "weekend" | "off";

export interface CollectionPlan {
  due: boolean;
  window: CollectionWindow;
  maxPages: number;
}

export function collectionPlanAt(date: Date): CollectionPlan {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  const weekend = weekday === "Sat" || weekday === "Sun";

  if (weekend) {
    if (minute === 0 && (hour === 10 || hour === 16 || hour === 22)) {
      return { due: true, window: "weekend", maxPages: 3 };
    }
    return { due: false, window: "off", maxPages: 0 };
  }

  if (hour === 8 && minute === 0) {
    return { due: true, window: "morning", maxPages: 3 };
  }
  if (hour >= 9 && hour <= 17 && minute === 0) {
    return { due: true, window: "workday", maxPages: 3 };
  }
  if ((hour === 19 || hour === 21) && minute === 0) {
    return { due: true, window: "evening", maxPages: 3 };
  }
  return { due: false, window: "off", maxPages: 0 };
}
