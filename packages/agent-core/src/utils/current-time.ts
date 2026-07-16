export interface CurrentTimeSnapshot {
  readonly iso: string;
  readonly today: string;
  readonly local: string;
  readonly timezone: string;
  readonly utcOffset: string;
}

function formatUtcOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const minutes = String(absMinutes % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

function formatIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const minutes = String(absMinutes % 60).padStart(2, '0');
  const offset = `${sign}${hours}:${minutes}`;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${offset}`;
}

export function formatCurrentTimeSnapshot(now: Date = new Date()): CurrentTimeSnapshot {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const local = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return {
    iso: formatIsoWithOffset(now),
    today,
    local,
    timezone,
    utcOffset: formatUtcOffset(now),
  };
}

export function buildCurrentTimeReminder(snapshot: CurrentTimeSnapshot): string {
  return `<current_time>
Authoritative host clock (do not guess from pretrained knowledge):
- Today: ${snapshot.today}
- Local: ${snapshot.local} (${snapshot.timezone}, ${snapshot.utcOffset})
- ISO: ${snapshot.iso}
For time-sensitive WebSearch/FetchURL, include the correct year. Call GetCurrentTime if this is stale.
</current_time>`;
}
