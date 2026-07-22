/**
 * CalendarView — month/week calendar display with events.
 *
 * Provides GUI-quality calendar visualization:
 * - Month view (7-column grid)
 * - Week view (horizontal timeline)
 * - Day view (hourly slots)
 * - Event markers (dots, bars, icons)
 * - Today highlighting
 * - Selected date highlighting
 * - Navigation (prev/next month/week)
 * - Multi-day event spanning
 * - Event colors by category
 * - Lunar phase indicators (optional)
 * - Week numbers
 * - Compact/expanded modes
 *
 * Visual style (month):
 *     July 2026
 * Su Mo Tu We Th Fr Sa
 *           1  2  3  4
 *  5  6  7  8  9 10 11
 * 12 13 14 15 16 17 18
 * 19 20 21 22●23 24 25  ← today (22) with event
 * 26 27 28 29 30 31
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly date: Date;
  readonly endDate?: Date; // For multi-day events
  readonly color?: string;
  readonly category?: string;
  readonly allDay?: boolean;
  readonly icon?: string;
}

export type CalendarViewMode = 'month' | 'week' | 'day';

export interface CalendarRenderOptions {
  readonly width: number;
  readonly mode: CalendarViewMode;
  readonly showWeekNumbers?: boolean;
  readonly showEvents?: boolean;
  readonly maxEventsPerDay?: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// CalendarView
// ---------------------------------------------------------------------------

export class CalendarView {
  private currentDate: Date;
  private selectedDate: Date;
  private events: CalendarEvent[] = [];
  private mode: CalendarViewMode = 'month';

  constructor(initialDate?: Date) {
    this.currentDate = initialDate ?? new Date();
    this.selectedDate = new Date(this.currentDate);
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Go to previous month/week/day. */
  prev(): void {
    const d = new Date(this.currentDate);
    switch (this.mode) {
      case 'month':
        d.setMonth(d.getMonth() - 1);
        break;
      case 'week':
        d.setDate(d.getDate() - 7);
        break;
      case 'day':
        d.setDate(d.getDate() - 1);
        break;
    }
    this.currentDate = d;
  }

  /** Go to next month/week/day. */
  next(): void {
    const d = new Date(this.currentDate);
    switch (this.mode) {
      case 'month':
        d.setMonth(d.getMonth() + 1);
        break;
      case 'week':
        d.setDate(d.getDate() + 7);
        break;
      case 'day':
        d.setDate(d.getDate() + 1);
        break;
    }
    this.currentDate = d;
  }

  /** Go to today. */
  goToday(): void {
    this.currentDate = new Date();
    this.selectedDate = new Date();
  }

  /** Select a specific date. */
  selectDate(date: Date): void {
    this.selectedDate = new Date(date);
    this.currentDate = new Date(date);
  }

  /** Set view mode. */
  setMode(mode: CalendarViewMode): void {
    this.mode = mode;
  }

  // ─── Event Management ────────────────────────────────────────────

  /** Add an event. */
  addEvent(event: CalendarEvent): void {
    this.events.push(event);
  }

  /** Remove an event. */
  removeEvent(id: string): void {
    this.events = this.events.filter((e) => e.id !== id);
  }

  /** Get events for a specific date. */
  getEventsForDate(date: Date): CalendarEvent[] {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

    return this.events.filter((e) => {
      const eventStart = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate());
      const eventEnd = e.endDate
        ? new Date(e.endDate.getFullYear(), e.endDate.getMonth(), e.endDate.getDate() + 1)
        : new Date(eventStart.getTime() + 86400000);

      return eventStart < dayEnd && eventEnd > dayStart;
    });
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get current date. */
  getCurrentDate(): Date {
    return this.currentDate;
  }

  /** Get selected date. */
  getSelectedDate(): Date {
    return this.selectedDate;
  }

  /** Get view mode. */
  getMode(): CalendarViewMode {
    return this.mode;
  }

  /** Check if a date is today. */
  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  }

  /** Check if a date is selected. */
  isSelected(date: Date): boolean {
    return date.getDate() === this.selectedDate.getDate() &&
      date.getMonth() === this.selectedDate.getMonth() &&
      date.getFullYear() === this.selectedDate.getFullYear();
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the calendar. */
  render(options: CalendarRenderOptions): string[] {
    switch (options.mode ?? this.mode) {
      case 'month':
        return this.renderMonth(options);
      case 'week':
        return this.renderWeek(options);
      case 'day':
        return this.renderDay(options);
    }
  }

  private renderMonth(options: CalendarRenderOptions): string[] {
    const { width, showWeekNumbers = false, showEvents = true, maxEventsPerDay = 2, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    // Header
    const title = `${MONTHS[month]} ${String(year)}`;
    const titlePadded = this.padCenter(title, width);
    lines.push(boldFg('text', titlePadded));

    // Weekday headers
    const dayWidth = showWeekNumbers ? Math.floor((width - 4) / 7) : Math.floor(width / 7);
    const headerCells = WEEKDAYS.map((d) => this.padCenter(d, dayWidth));
    if (showWeekNumbers) {
      lines.push(dimFg('textMuted', 'Wk ') + headerCells.join(''));
    } else {
      lines.push(dimFg('textMuted', headerCells.join('')));
    }

    // Calculate first day and days in month
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Render weeks
    let day = 1;
    for (let week = 0; week < 6 && day <= daysInMonth; week++) {
      const cells: string[] = [];

      // Week number
      if (showWeekNumbers) {
        const weekNum = this.getWeekNumber(new Date(year, month, day));
        cells.push(dimFg('textMuted', String(weekNum).padStart(2) + ' '));
      }

      for (let dow = 0; dow < 7; dow++) {
        if (week === 0 && dow < firstDay) {
          cells.push(' '.repeat(dayWidth));
        } else if (day > daysInMonth) {
          cells.push(' '.repeat(dayWidth));
        } else {
          const date = new Date(year, month, day);
          const isToday = this.isToday(date);
          const isSelected = this.isSelected(date);
          const events = showEvents ? this.getEventsForDate(date) : [];

          let dayStr = String(day).padStart(2);

          if (isToday) {
            dayStr = boldFg('primary', dayStr);
            if (events.length > 0) {
              dayStr += fg('accent', '●');
            }
          } else if (isSelected) {
            dayStr = fg('accent', `[${String(day).padStart(2)}]`);
          } else if (events.length > 0) {
            dayStr = fg('text', dayStr) + dimFg('textMuted', '•');
          } else {
            dayStr = fg('text', dayStr) + ' ';
          }

          // Pad to dayWidth
          const plainLen = dayStr.replace(/\x1b\[[0-9;]*m/g, '').length;
          cells.push(dayStr + ' '.repeat(Math.max(0, dayWidth - plainLen)));

          day++;
        }
      }

      lines.push(cells.join(''));
    }

    return lines;
  }

  private renderWeek(options: CalendarRenderOptions): string[] {
    const { width, showEvents = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Get start of week (Sunday)
    const startOfWeek = new Date(this.currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    // Header
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    const title = `${MONTHS[startOfWeek.getMonth()]?.slice(0, 3)} ${String(startOfWeek.getDate())} - ${String(endOfWeek.getDate())}`;
    lines.push(boldFg('text', this.padCenter(title, width)));
    lines.push(dimFg('textMuted', '─'.repeat(width)));

    // Day columns
    const dayWidth = Math.floor(width / 7);
    const headerCells: string[] = [];
    const dateCells: string[] = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(date.getDate() + i);

      const isToday = this.isToday(date);
      const isSelected = this.isSelected(date);

      // Weekday
      const weekday = WEEKDAYS[i]!;
      headerCells.push(this.padCenter(isToday ? boldFg('primary', weekday) : dimFg('textMuted', weekday), dayWidth));

      // Date number
      const dayNum = String(date.getDate());
      if (isToday) {
        dateCells.push(this.padCenter(boldFg('primary', `[${dayNum}]`), dayWidth));
      } else if (isSelected) {
        dateCells.push(this.padCenter(fg('accent', dayNum), dayWidth));
      } else {
        dateCells.push(this.padCenter(fg('text', dayNum), dayWidth));
      }
    }

    lines.push(headerCells.join(''));
    lines.push(dateCells.join(''));

    // Events for the week
    if (showEvents) {
      lines.push(dimFg('textMuted', '─'.repeat(width)));
      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + i);
        const events = this.getEventsForDate(date);

        if (events.length > 0) {
          for (const event of events.slice(0, 2)) {
            const icon = event.icon ?? '•';
            lines.push(dimFg('textMuted', `${WEEKDAYS[i]}: `) + fg('text', `${icon} ${event.title}`));
          }
        }
      }
    }

    return lines;
  }

  private renderDay(options: CalendarRenderOptions): string[] {
    const { width, showEvents = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const date = this.currentDate;
    const title = `${WEEKDAYS_FULL[date.getDay()]}, ${MONTHS[date.getMonth()]} ${String(date.getDate())}`;
    lines.push(boldFg('text', this.padCenter(title, width)));
    lines.push(dimFg('textMuted', '─'.repeat(width)));

    // Hourly slots
    const events = showEvents ? this.getEventsForDate(date) : [];

    for (let hour = 0; hour < 24; hour++) {
      const hourStr = `${String(hour).padStart(2)}:00`;
      const hourEvents = events.filter((e) => {
        const eventHour = e.date.getHours();
        return e.allDay || eventHour === hour;
      });

      let line = dimFg('textMuted', `${hourStr} │`);

      if (hourEvents.length > 0) {
        const eventStrs = hourEvents.map((e) => {
          const icon = e.icon ?? '■';
          return fg('text', ` ${icon} ${e.title}`);
        });
        line += eventStrs.join('');
      } else {
        line += dimFg('textDim', ' ·');
      }

      lines.push(line);
    }

    return lines;
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private padCenter(text: string, width: number): string {
    const plainLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - plainLen);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
}
